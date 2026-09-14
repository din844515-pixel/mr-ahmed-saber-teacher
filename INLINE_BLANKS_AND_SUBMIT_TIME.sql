-- Mr. Ahmed Saber — inline fill-in-the-blank answers + exact submission timestamp in teacher results.
-- For auto-graded questions containing dotted/underscore blanks, submitted text is graded against
-- the correct option text when the existing correct_answer is an option key (A/B/C/D/E).
-- Manual questions keep their answers for teacher grading.

CREATE OR REPLACE FUNCTION public.submit_exam(p_attempt_id bigint,p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE
  a record; s record; e record; q record;
  chosen text; ok boolean;
  v_score numeric:=0; v_total numeric:=0; manual_count integer:=0; result_id bigint;
  cd jsonb; qs jsonb; ans_arr jsonb; expected_arr jsonb;
  expected text; actual text; sub_points numeric; earned numeric;
  j integer; all_ok boolean; kind text;
  expected_keys text; actual_keys text; correct_selected_count integer; unique_selected_count integer;
  blank_count integer; raw_expected text; expected_option_key text; expected_option_text text;
  has_inline_blanks boolean;
BEGIN
  SELECT * INTO a FROM public.exam_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','المحاولة غير موجودة.'); END IF;
  IF a.submitted_at IS NOT NULL THEN RETURN jsonb_build_object('success',false,'message','تم تسليم الامتحان بالفعل، ولا يمكن إعادته.'); END IF;

  SELECT * INTO s FROM public.students WHERE id=a.student_id AND coalesce(active,true)=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','بيانات الطالب غير موجودة.'); END IF;

  SELECT * INTO e FROM public.exams WHERE id=a.exam_id AND coalesce(active,true)=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','الامتحان غير متاح.'); END IF;

  DELETE FROM public.exam_answers WHERE attempt_id=a.id;

  FOR q IN SELECT * FROM public.exam_questions WHERE exam_id=a.exam_id ORDER BY coalesce(position,question_order,id) LOOP
    v_total:=v_total+coalesce(q.points,1);
    chosen:=trim(coalesce(p_answers->>q.id::text,''));
    cd:=coalesce(q.conversation_data,'{}'::jsonb);
    kind:=coalesce(cd->>'kind','');
    has_inline_blanks := coalesce(q.question,'') ~ '(\.{4,}|…{2,}|_{3,}|\[\[\d+\]\])';

    IF lower(coalesce(q.grading_mode,'auto'))='manual' THEN
      manual_count:=manual_count+1;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),NULL,0);

    ELSIF lower(coalesce(q.question_type,'mcq'))='multi_mcq' THEN
      BEGIN
        ans_arr:=CASE WHEN chosen<>'' THEN chosen::jsonb ELSE '[]'::jsonb END;
      EXCEPTION WHEN OTHERS THEN
        ans_arr:='[]'::jsonb;
      END;

      expected_keys:=array_to_string(
        ARRAY(
          SELECT upper(trim(value))
          FROM unnest(string_to_array(coalesce(q.correct_answer,''),',')) value
          WHERE trim(value)<>''
          ORDER BY upper(trim(value))
        ), ','
      );
      actual_keys:=array_to_string(
        ARRAY(
          SELECT upper(trim(value))
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(ans_arr)='array' THEN ans_arr ELSE '[]'::jsonb END)
          ORDER BY upper(trim(value))
        ), ','
      );
      unique_selected_count := (
        SELECT count(*) FROM (
          SELECT upper(trim(z.value)) AS value
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(ans_arr)='array' THEN ans_arr ELSE '[]'::jsonb END) z(value)
          GROUP BY upper(trim(z.value))
        ) u
      );
      correct_selected_count := (
        SELECT count(*) FROM (
          SELECT DISTINCT upper(trim(z.value)) AS value
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(ans_arr)='array' THEN ans_arr ELSE '[]'::jsonb END) z(value)
        ) sel
        WHERE sel.value IN (
          SELECT upper(trim(value)) FROM unnest(string_to_array(coalesce(q.correct_answer,''),',')) value
        )
      );

      ok:=jsonb_typeof(ans_arr)='array'
          AND jsonb_array_length(ans_arr)=2
          AND unique_selected_count=2
          AND actual_keys=expected_keys
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(ans_arr) z(value)
            WHERE upper(trim(z.value)) NOT IN ('A','B','C','D','E')
          );

      IF ok THEN
        earned:=coalesce(q.points,1);
      ELSIF jsonb_typeof(ans_arr)='array'
            AND jsonb_array_length(ans_arr)=2
            AND unique_selected_count=2
            AND correct_selected_count=1
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(ans_arr) z(value)
              WHERE upper(trim(z.value)) NOT IN ('A','B','C','D','E')
            ) THEN
        earned:=coalesce(q.points,1)/2;
      ELSE
        earned:=0;
      END IF;

      IF earned>0 THEN v_score:=v_score+earned; END IF;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),CASE WHEN ok THEN true ELSE false END,earned);

    ELSIF lower(coalesce(q.question_type,'mcq')) IN ('conversation','dialogue') THEN
      ans_arr:=CASE WHEN chosen<>'' THEN chosen::jsonb ELSE '[]'::jsonb END;
      earned:=0; all_ok:=true; qs:=coalesce(cd->'blanks','[]'::jsonb);
      FOR j IN 0..GREATEST(jsonb_array_length(qs)-1,-1) LOOP
        expected:=trim(coalesce(qs->j->>'answer',''));
        actual:=trim(coalesce(ans_arr->>j,''));
        sub_points:=coalesce((qs->j->>'points')::numeric,coalesce(q.points,1)/GREATEST(jsonb_array_length(qs),1));
        IF expected<>'' AND regexp_replace(lower(actual),'[[:punct:]]','','g')=regexp_replace(lower(expected),'[[:punct:]]','','g') THEN
          earned:=earned+sub_points;
        ELSE all_ok:=false; END IF;
      END LOOP;
      IF jsonb_array_length(qs)=0 THEN all_ok:=false; END IF;
      v_score:=v_score+earned;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),CASE WHEN chosen<>'' THEN all_ok ELSE false END,earned);

    ELSIF kind IN ('reading','story','find_correct','complete','rewrite') OR lower(coalesce(q.question_type,''))='written_group' THEN
      ans_arr:=CASE WHEN chosen<>'' THEN chosen::jsonb ELSE '[]'::jsonb END;
      earned:=0; all_ok:=true; qs:=coalesce(cd->'questions','[]'::jsonb);
      FOR j IN 0..GREATEST(jsonb_array_length(qs)-1,-1) LOOP
        expected:=trim(coalesce(qs->j->>'answer',''));
        actual:=trim(coalesce(ans_arr->>j,''));
        sub_points:=coalesce((qs->j->>'points')::numeric,coalesce(q.points,1)/GREATEST(jsonb_array_length(qs),1));
        IF expected<>'' AND regexp_replace(lower(actual),'[[:punct:]]','','g')=regexp_replace(lower(expected),'[[:punct:]]','','g') THEN
          earned:=earned+sub_points;
        ELSE all_ok:=false; END IF;
      END LOOP;
      IF jsonb_array_length(qs)=0 THEN all_ok:=false; END IF;
      v_score:=v_score+earned;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),CASE WHEN chosen<>'' THEN all_ok ELSE false END,earned);

    ELSIF has_inline_blanks THEN
      -- Generic dotted/underscore fill-ins. Auto MCQ blanks compare against option text.
      BEGIN
        ans_arr:=CASE
          WHEN chosen='' THEN '[]'::jsonb
          WHEN left(chosen,1)='[' THEN chosen::jsonb
          ELSE jsonb_build_array(chosen)
        END;
      EXCEPTION WHEN OTHERS THEN
        ans_arr:='[]'::jsonb;
      END;

      raw_expected:=trim(coalesce(q.correct_answer,''));
      expected_arr:='[]'::jsonb;

      IF left(raw_expected,1)='[' THEN
        BEGIN expected_arr:=raw_expected::jsonb; EXCEPTION WHEN OTHERS THEN expected_arr:=jsonb_build_array(raw_expected); END;
      ELSIF position('||' in raw_expected)>0 THEN
        expected_arr:=to_jsonb(string_to_array(raw_expected,'||'));
      ELSIF raw_expected<>'' AND lower(coalesce(q.question_type,'mcq'))='mcq' THEN
        expected_option_key:=upper(trim(raw_expected));
        expected_option_text:='';
        BEGIN
          SELECT COALESCE(opt->>'text','') INTO expected_option_text
          FROM jsonb_array_elements(COALESCE(q.options,'[]'::jsonb)) opt
          WHERE upper(trim(opt->>'key'))=expected_option_key
          LIMIT 1;
        EXCEPTION WHEN OTHERS THEN expected_option_text:=''; END;
        IF expected_option_text='' THEN
          expected_option_text:=CASE expected_option_key
            WHEN 'A' THEN coalesce(q.option_a,'')
            WHEN 'B' THEN coalesce(q.option_b,'')
            WHEN 'C' THEN coalesce(q.option_c,'')
            WHEN 'D' THEN coalesce(q.option_d,'')
            ELSE '' END;
        END IF;
        expected_arr:=jsonb_build_array(COALESCE(NULLIF(expected_option_text,''),raw_expected));
      ELSE
        expected_arr:=jsonb_build_array(raw_expected);
      END IF;

      blank_count:=GREATEST(jsonb_array_length(ans_arr),jsonb_array_length(expected_arr),1);
      earned:=0; all_ok:=true;
      FOR j IN 0..blank_count-1 LOOP
        expected:=trim(coalesce(expected_arr->>j,''));
        actual:=trim(coalesce(ans_arr->>j,''));
        sub_points:=coalesce(q.points,1)/blank_count;
        IF expected<>'' AND actual<>'' AND regexp_replace(lower(actual),'[[:punct:]]','','g')=regexp_replace(lower(expected),'[[:punct:]]','','g') THEN
          earned:=earned+sub_points;
        ELSE all_ok:=false; END IF;
      END LOOP;

      v_score:=v_score+earned;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),CASE WHEN chosen<>'' AND all_ok THEN true ELSE false END,earned);

    ELSE
      ok:=chosen<>'' AND regexp_replace(lower(chosen),'[[:punct:]]','','g')=regexp_replace(lower(trim(coalesce(q.correct_answer,''))),'[[:punct:]]','','g');
      IF ok THEN v_score:=v_score+coalesce(q.points,1); END IF;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),ok,CASE WHEN ok THEN coalesce(q.points,1) ELSE 0 END);
    END IF;
  END LOOP;

  UPDATE public.exam_attempts
  SET submitted_at=now(),score=v_score,total_score=v_total,status=CASE WHEN manual_count=0 THEN 'graded' ELSE 'submitted' END
  WHERE id=a.id;

  INSERT INTO public.exam_results(student_id,exam_id,score,total_score,owner_id)
  VALUES(s.id,e.id,v_score,v_total,e.owner_id)
  ON CONFLICT (exam_id,student_id)
  DO UPDATE SET score=EXCLUDED.score,total_score=EXCLUDED.total_score,created_at=now(),owner_id=EXCLUDED.owner_id
  RETURNING id INTO result_id;

  RETURN jsonb_build_object('success',true,'result_id',result_id,'score',v_score,'total_score',v_total,'manual_count',manual_count,'status',CASE WHEN manual_count=0 THEN 'graded' ELSE 'submitted' END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.submit_exam(bigint,jsonb) TO anon,authenticated;
