-- MR. Ahmed Saber — Partial grading for grouped/blank questions
-- Each sub-question/blank earns its own points.
-- Example: 2 correct out of 4 => 2/4, not 0/4.
-- This migration is already applied to the current Supabase project.

CREATE OR REPLACE FUNCTION public.submit_exam(p_attempt_id bigint,p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  a record; s record; e record; q record;
  chosen text; ok boolean;
  v_score numeric:=0; v_total numeric:=0; manual_count integer:=0; result_id bigint;
  cd jsonb; qs jsonb; ans_arr jsonb;
  expected text; actual text; sub_points numeric; earned numeric;
  j integer; all_ok boolean; kind text;
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

    -- Manual means the teacher decides the points later.
    IF lower(coalesce(q.grading_mode,'auto'))='manual' THEN
      manual_count:=manual_count+1;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),NULL,0);

    -- Conversation: grade every blank independently.
    ELSIF lower(coalesce(q.question_type,'mcq')) IN ('conversation','dialogue') THEN
      ans_arr:=CASE WHEN chosen<>'' THEN chosen::jsonb ELSE '[]'::jsonb END;
      earned:=0; all_ok:=true;
      qs:=coalesce(cd->'blanks','[]'::jsonb);
      FOR j IN 0..GREATEST(jsonb_array_length(qs)-1,-1) LOOP
        expected:=trim(coalesce(qs->j->>'answer',''));
        actual:=trim(coalesce(ans_arr->>j,''));
        sub_points:=coalesce((qs->j->>'points')::numeric,coalesce(q.points,1)/GREATEST(jsonb_array_length(qs),1));
        IF expected<>'' AND regexp_replace(lower(actual),'[[:punct:]]','','g')=regexp_replace(lower(expected),'[[:punct:]]','','g') THEN
          earned:=earned+sub_points;
        ELSE
          all_ok:=false;
        END IF;
      END LOOP;
      IF jsonb_array_length(qs)=0 THEN all_ok:=false; END IF;
      v_score:=v_score+earned;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),CASE WHEN chosen<>'' THEN all_ok ELSE false END,earned);

    -- Reading / Story / Find-Correct / Complete / Rewrite: grade each sub-question independently.
    ELSIF kind IN ('reading','story','find_correct','complete','rewrite') OR lower(coalesce(q.question_type,''))='written_group' THEN
      ans_arr:=CASE WHEN chosen<>'' THEN chosen::jsonb ELSE '[]'::jsonb END;
      earned:=0; all_ok:=true;
      qs:=coalesce(cd->'questions','[]'::jsonb);
      FOR j IN 0..GREATEST(jsonb_array_length(qs)-1,-1) LOOP
        expected:=trim(coalesce(qs->j->>'answer',''));
        actual:=trim(coalesce(ans_arr->>j,''));
        sub_points:=coalesce((qs->j->>'points')::numeric,coalesce(q.points,1)/GREATEST(jsonb_array_length(qs),1));
        IF expected<>'' AND regexp_replace(lower(actual),'[[:punct:]]','','g')=regexp_replace(lower(expected),'[[:punct:]]','','g') THEN
          earned:=earned+sub_points;
        ELSE
          all_ok:=false;
        END IF;
      END LOOP;
      IF jsonb_array_length(qs)=0 THEN all_ok:=false; END IF;
      v_score:=v_score+earned;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),CASE WHEN chosen<>'' THEN all_ok ELSE false END,earned);

    ELSE
      ok:=chosen<>'' AND regexp_replace(lower(chosen),'[[:punct:]]','','g')=regexp_replace(lower(trim(coalesce(q.correct_answer,''))),'[[:punct:]]','','g');
      IF ok THEN v_score:=v_score+coalesce(q.points,1); END IF;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,nullif(chosen,''),ok,CASE WHEN ok THEN coalesce(q.points,1) ELSE 0 END);
    END IF;
  END LOOP;

  UPDATE public.exam_attempts SET submitted_at=now(),score=v_score,total_score=v_total,status='submitted' WHERE id=a.id;
  INSERT INTO public.exam_results(student_id,exam_id,score,total_score,owner_id)
  VALUES(s.id,e.id,v_score,v_total,e.owner_id)
  ON CONFLICT (exam_id,student_id) DO UPDATE SET score=EXCLUDED.score,total_score=EXCLUDED.total_score,created_at=now(),owner_id=EXCLUDED.owner_id
  RETURNING id INTO result_id;

  RETURN jsonb_build_object('success',true,'result_id',result_id,'score',v_score,'total_score',v_total,'manual_count',manual_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_exam(bigint,jsonb) TO anon,authenticated;

-- Teacher answer view exposes grading_mode so the UI can distinguish manual/auto.
CREATE OR REPLACE FUNCTION public.teacher_exam_answers(p_exam_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(row_data ORDER BY student_name,question_order),'[]'::jsonb) INTO result
  FROM (
    SELECT jsonb_build_object(
      'student_id',s.id,'student_name',s.name,'student_gender',coalesce(s.gender,'male'),
      'submitted_at',a.submitted_at,'attempt_score',coalesce(a.score,0),'attempt_total',coalesce(a.total_score,0),
      'answer_id',ea.id,'question_id',q.id,'question',coalesce(q.question,q.question_text,''),
      'question_type',coalesce(q.question_type,'mcq'),'grading_mode',coalesce(q.grading_mode,'auto'),
      'conversation_data',q.conversation_data,'answer_text',ea.answer_text,'is_correct',ea.is_correct,
      'points',coalesce(q.points,1),'points_awarded',coalesce(ea.points_awarded,0),
      'question_order',coalesce(q.position,q.question_order,q.id)
    ) row_data,
    s.name student_name,coalesce(q.position,q.question_order,q.id) question_order
    FROM public.exam_attempts a
    JOIN public.students s ON s.id=a.student_id
    JOIN public.exams e ON e.id=a.exam_id
    JOIN public.exam_questions q ON q.exam_id=e.id
    LEFT JOIN public.exam_answers ea ON ea.attempt_id=a.id AND ea.question_id=q.id
    WHERE e.id=p_exam_id AND e.owner_id=auth.uid() AND a.submitted_at IS NOT NULL
  ) x;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.teacher_exam_answers(bigint) TO authenticated;
