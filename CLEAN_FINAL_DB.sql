-- MR. Ahmed Saber CLEAN FINAL database repair
-- Run this migration once on the CURRENT Supabase project.

-- 1) Keep the one-attempt rule and make result IDs reliable.
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_exam_id_student_id_key
  ON public.exam_attempts(exam_id, student_id);
CREATE UNIQUE INDEX IF NOT EXISTS exam_results_exam_id_student_id_key
  ON public.exam_results(exam_id, student_id);
-- Remove duplicate legacy indexes if they exist; keep the canonical unique indexes above.
DROP INDEX IF EXISTS public.exam_attempts_exam_student_unique;
DROP INDEX IF EXISTS public.exam_attempts_one_per_student;
DROP INDEX IF EXISTS public.exam_results_exam_student_unique;

-- 2) Make sure exam result IDs can never be NULL.
CREATE SEQUENCE IF NOT EXISTS public.exam_results_id_seq;
ALTER SEQUENCE public.exam_results_id_seq OWNED BY public.exam_results.id;
ALTER TABLE public.exam_results ALTER COLUMN id SET DEFAULT nextval('public.exam_results_id_seq');
SELECT setval('public.exam_results_id_seq', COALESCE((SELECT max(id) FROM public.exam_results),0)+1, false);

-- 3) Secure student deletion. Child records use ON DELETE CASCADE in the current schema.
CREATE OR REPLACE FUNCTION public.delete_student(p_student_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','يجب تسجيل دخول المستر أولًا.');
  END IF;
  SELECT owner_id INTO v_owner FROM public.students WHERE id=p_student_id;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','الطالب غير موجود.');
  END IF;
  IF v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('success',false,'message','لا توجد صلاحية لحذف هذا الطالب.');
  END IF;
  DELETE FROM public.students WHERE id=p_student_id AND owner_id=auth.uid();
  RETURN jsonb_build_object('success',true,'message','تم حذف الطالب وجميع بياناته المرتبطة بنجاح.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_student(bigint) TO authenticated;

-- 4) Student portal: current schema uses active, not is_published.
CREATE OR REPLACE FUNCTION public.student_portal(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE s record; v jsonb; e jsonb; a jsonb;
BEGIN
  SELECT * INTO s FROM public.students
  WHERE upper(trim(coalesce(nullif(student_code,''),code)))=upper(trim(p_code))
    AND coalesce(active,true)=true LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','كود الطالب غير صحيح'); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'title',x.title,'description',x.description,
    'url',coalesce(x.url,x.video_url,x."Video_ur1",x.file_url),'grade',x.grade
  ) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v
  FROM public.videos x
  WHERE coalesce(x.owner_id,s.owner_id)=s.owner_id AND coalesce(x.active,true)=true
    AND (x.grade IS NULL OR x.grade='' OR x.grade=s.grade);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'title',x.title,'grade',x.grade,
    'duration_minutes',coalesce(x.duration_minutes,x.duration,30),
    'show_answers',coalesce(x.show_answers,false)
  ) ORDER BY x.created_at DESC),'[]'::jsonb) INTO e
  FROM public.exams x
  WHERE coalesce(x.owner_id,s.owner_id)=s.owner_id AND coalesce(x.active,true)=true
    AND (x.grade IS NULL OR x.grade='' OR x.grade=s.grade);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'title',x.title,'body',x.body,'grade',x.grade,'created_at',x.created_at
  ) ORDER BY x.created_at DESC),'[]'::jsonb) INTO a
  FROM public.announcements x
  WHERE coalesce(x.owner_id,s.owner_id)=s.owner_id AND coalesce(x.active,true)=true
    AND (x.grade IS NULL OR x.grade='' OR x.grade=s.grade);

  RETURN jsonb_build_object(
    'success',true,
    'student',jsonb_build_object('id',s.id,'name',s.name,
      'student_code',coalesce(nullif(s.student_code,''),s.code),'grade',s.grade,
      'gender',coalesce(s.gender,'male'),'paid',coalesce(s.paid,true),
      'exempt',coalesce(s.exempt,false)),
    'videos',v,'exams',e,'announcements',a
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.student_portal(text) TO anon,authenticated;

-- 5) Open/resume one attempt only; block re-entry after submission.
CREATE OR REPLACE FUNCTION public.student_exam(p_code text,p_exam_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; e record; a record; qs jsonb;
BEGIN
  SELECT * INTO s FROM public.students
  WHERE upper(trim(coalesce(nullif(student_code,''),code)))=upper(trim(p_code))
    AND coalesce(active,true)=true LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','كود الطالب غير صحيح'); END IF;

  SELECT * INTO e FROM public.exams
  WHERE id=p_exam_id AND coalesce(active,true)=true
    AND (owner_id IS NULL OR owner_id=s.owner_id)
    AND (grade IS NULL OR grade='' OR grade=s.grade);
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','الامتحان غير متاح لهذا الطالب'); END IF;

  SELECT * INTO a FROM public.exam_attempts WHERE exam_id=e.id AND student_id=s.id LIMIT 1;
  IF FOUND AND a.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'message',CASE WHEN coalesce(s.gender,'male')='female'
      THEN 'لقد خضتِ هذا الامتحان من قبل، ولا يمكن إعادة دخوله.'
      ELSE 'لقد خضتَ هذا الامتحان من قبل، ولا يمكن إعادة دخوله.' END);
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.exam_attempts(exam_id,student_id,status)
    VALUES(e.id,s.id,'in_progress') RETURNING * INTO a;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'question',coalesce(q.question,q.question_text,''),
    'question_type',coalesce(q.question_type,'mcq'),'points',coalesce(q.points,1),
    'option_a',q.option_a,'option_b',q.option_b,'option_c',q.option_c,'option_d',q.option_d,
    'position',coalesce(q.position,q.question_order),
    'conversation_data',q.conversation_data
  ) ORDER BY coalesce(q.position,q.question_order,q.id)),'[]'::jsonb) INTO qs
  FROM public.exam_questions q WHERE q.exam_id=e.id;

  RETURN jsonb_build_object('success',true,'attempt_id',a.id,'started_at',a.started_at,
    'student',jsonb_build_object('id',s.id,'name',s.name,'gender',coalesce(s.gender,'male')),
    'exam',jsonb_build_object('id',e.id,'title',e.title,
      'duration_minutes',coalesce(e.duration_minutes,e.duration,30),
      'show_answers',coalesce(e.show_answers,false)), 'questions',qs);
END;
$$;
GRANT EXECUTE ON FUNCTION public.student_exam(text,bigint) TO anon,authenticated;

-- 6) Final submission: no NULL result id, MCQ auto-grading + essay storage.
CREATE OR REPLACE FUNCTION public.submit_exam(p_attempt_id bigint,p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  a record;
  s record;
  e record;
  q record;
  chosen text;
  ok boolean;
  v_score numeric := 0;
  v_total numeric := 0;
  essay_count integer := 0;
  result_id bigint;
BEGIN
  SELECT * INTO a FROM public.exam_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','المحاولة غير موجودة.');
  END IF;

  IF a.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'message','تم تسليم الامتحان بالفعل، ولا يمكن إعادته.');
  END IF;

  SELECT * INTO s FROM public.students
  WHERE id=a.student_id AND COALESCE(active,true)=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','بيانات الطالب غير موجودة.');
  END IF;

  SELECT * INTO e FROM public.exams
  WHERE id=a.exam_id AND COALESCE(active,true)=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','الامتحان غير متاح.');
  END IF;

  DELETE FROM public.exam_answers WHERE attempt_id=a.id;

  FOR q IN
    SELECT * FROM public.exam_questions
    WHERE exam_id=a.exam_id
    ORDER BY COALESCE(position,question_order,id)
  LOOP
    v_total := v_total + COALESCE(q.points,1);
    chosen := trim(COALESCE(p_answers->>q.id::text,''));

    IF lower(COALESCE(q.question_type,'mcq')) IN ('essay','written','مقالي') THEN
      essay_count := essay_count + 1;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,NULLIF(chosen,''),NULL,0);
    ELSE
      ok := chosen <> '' AND upper(chosen)=upper(COALESCE(q.correct_answer,''));
      IF ok THEN
        v_score := v_score + COALESCE(q.points,1);
      END IF;
      INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded)
      VALUES(a.id,q.id,NULLIF(chosen,''),ok,CASE WHEN ok THEN COALESCE(q.points,1) ELSE 0 END);
    END IF;
  END LOOP;

  UPDATE public.exam_attempts ea
  SET score=v_score,total_score=v_total,submitted_at=now(),status='submitted'
  WHERE ea.id=a.id;

  INSERT INTO public.exam_results(student_id,exam_id,score,total_score,owner_id)
  VALUES(s.id,e.id,v_score,v_total,e.owner_id)
  ON CONFLICT (exam_id,student_id)
  DO UPDATE SET
    score=EXCLUDED.score,
    total_score=EXCLUDED.total_score,
    created_at=now(),
    owner_id=EXCLUDED.owner_id
  RETURNING id INTO result_id;

  RETURN jsonb_build_object(
    'success',true,
    'result_id',result_id,
    'score',v_score,
    'total_score',v_total,
    'essay_count',essay_count,
    'show_answers',COALESCE(e.show_answers,false)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_exam(bigint,jsonb) TO anon,authenticated;

-- 7) Teacher view of every submitted answer (including essay answers).
CREATE OR REPLACE FUNCTION public.teacher_exam_answers(p_exam_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY student_name, question_order), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      jsonb_build_object(
        'student_id', s.id,
        'student_name', s.name,
        'student_gender', COALESCE(s.gender,'male'),
        'submitted_at', a.submitted_at,
        'attempt_score', COALESCE(a.score,0),
        'attempt_total', COALESCE(a.total_score,0),
        'answer_id', ea.id,
        'question_id', q.id,
        'question', COALESCE(q.question,q.question_text,''),
        'question_type', COALESCE(q.question_type,'mcq'),
        'answer_text', ea.answer_text,
        'is_correct', ea.is_correct,
        'points', COALESCE(q.points,1),
        'points_awarded', COALESCE(ea.points_awarded,0),
        'question_order', COALESCE(q.position,q.question_order,q.id)
      ) AS row_data,
      s.name AS student_name,
      COALESCE(q.position,q.question_order,q.id) AS question_order
    FROM public.exam_attempts a
    JOIN public.students s ON s.id=a.student_id
    JOIN public.exams e ON e.id=a.exam_id
    JOIN public.exam_questions q ON q.exam_id=e.id
    LEFT JOIN public.exam_answers ea
      ON ea.attempt_id=a.id AND ea.question_id=q.id
    WHERE e.id=p_exam_id
      AND e.owner_id=auth.uid()
      AND a.submitted_at IS NOT NULL
  ) x;

  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.teacher_exam_answers(bigint) TO authenticated;

-- 8) Manually grade an essay answer and immediately recalculate the attempt/result.
CREATE OR REPLACE FUNCTION public.grade_essay_answer(p_answer_id bigint,p_points numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_attempt_id bigint;
  v_question_id bigint;
  v_max numeric;
  v_exam_id bigint;
  v_student_id bigint;
  v_owner_id uuid;
  v_score numeric;
  v_total numeric;
BEGIN
  SELECT
    ea.attempt_id,
    ea.question_id,
    COALESCE(q.points,1),
    a.exam_id,
    a.student_id,
    e.owner_id
  INTO
    v_attempt_id,v_question_id,v_max,v_exam_id,v_student_id,v_owner_id
  FROM public.exam_answers ea
  JOIN public.exam_attempts a ON a.id=ea.attempt_id
  JOIN public.exam_questions q ON q.id=ea.question_id
  JOIN public.exams e ON e.id=a.exam_id
  WHERE ea.id=p_answer_id
    AND e.owner_id=auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','الإجابة غير موجودة أو لا توجد صلاحية.');
  END IF;

  IF lower(COALESCE((SELECT question_type FROM public.exam_questions WHERE id=v_question_id),'mcq'))
     NOT IN ('essay','written','مقالي') THEN
    RETURN jsonb_build_object('success',false,'message','هذه ليست إجابة سؤال مقالي.');
  END IF;

  IF p_points < 0 OR p_points > v_max THEN
    RETURN jsonb_build_object('success',false,'message','الدرجة خارج نطاق السؤال.');
  END IF;

  UPDATE public.exam_answers
  SET points_awarded=p_points
  WHERE id=p_answer_id;

  SELECT
    COALESCE(SUM(COALESCE(ea.points_awarded,0)),0),
    COALESCE(SUM(COALESCE(q.points,1)),0)
  INTO v_score,v_total
  FROM public.exam_answers ea
  JOIN public.exam_questions q ON q.id=ea.question_id
  WHERE ea.attempt_id=v_attempt_id;

  UPDATE public.exam_attempts
  SET score=v_score,total_score=v_total
  WHERE id=v_attempt_id;

  UPDATE public.exam_results er
  SET score=v_score,total_score=v_total,created_at=now()
  WHERE er.exam_id=v_exam_id AND er.student_id=v_student_id AND er.owner_id=v_owner_id;

  RETURN jsonb_build_object(
    'success',true,
    'score',v_score,
    'total_score',v_total,
    'message','تم حفظ درجة السؤال وتحديث النتيجة.'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.grade_essay_answer(bigint,numeric) TO authenticated;

-- 9) Monthly attendance summary: one row per active student.
CREATE OR REPLACE FUNCTION public.teacher_monthly_attendance(p_year integer,p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY student_name), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      jsonb_build_object(
        'student_id',s.id,
        'student_name',s.name,
        'grade',s.grade,
        'exempt',COALESCE(s.exempt,false),
        'present_days',COUNT(a.student_id) FILTER (WHERE a.status='present'),
        'absent_days',COUNT(a.student_id) FILTER (WHERE a.status='absent'),
        'excused_days',COUNT(a.student_id) FILTER (WHERE a.status='excused'),
        'recorded_days',COUNT(a.student_id)
      ) AS row_data,
      s.name AS student_name
    FROM public.students s
    LEFT JOIN public.attendance a
      ON a.student_id=s.id
     AND a.attendance_date >= make_date(p_year,p_month,1)
     AND a.attendance_date < (make_date(p_year,p_month,1) + INTERVAL '1 month')::date
    WHERE s.owner_id=auth.uid()
      AND COALESCE(s.active,true)=true
    GROUP BY s.id,s.name,s.grade,s.exempt
  ) x;

  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.teacher_monthly_attendance(integer,integer) TO authenticated;

-- 10) Replace student deletion with an explicit cleanup so it does not depend on
-- foreign keys having ON DELETE CASCADE.
CREATE OR REPLACE FUNCTION public.delete_student(p_student_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','يجب تسجيل دخول المستر أولًا.');
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.students
  WHERE id=p_student_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','الطالب غير موجود.');
  END IF;

  IF v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('success',false,'message','لا توجد صلاحية لحذف هذا الطالب.');
  END IF;

  DELETE FROM public.exam_answers ea
  USING public.exam_attempts a
  WHERE ea.attempt_id=a.id AND a.student_id=p_student_id;

  DELETE FROM public.exam_attempts
  WHERE student_id=p_student_id;

  DELETE FROM public.exam_results
  WHERE student_id=p_student_id;

  DELETE FROM public.attendance
  WHERE student_id=p_student_id;

  DELETE FROM public.students
  WHERE id=p_student_id AND owner_id=auth.uid();

  RETURN jsonb_build_object(
    'success',true,
    'message','تم حذف الطالب والكود والحضور والنتائج ومحاولات الامتحانات المرتبطة به.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_student(bigint) TO authenticated;

-- FINAL V14 PATCHES
CREATE OR REPLACE FUNCTION public.student_portal(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE s record; v jsonb; e jsonb; a jsonb;
BEGIN
 SELECT * INTO s FROM public.students WHERE upper(trim(coalesce(nullif(student_code,''),code)))=upper(trim(p_code)) AND coalesce(active,true)=true LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','كود الطالب غير صحيح'); END IF;
 IF coalesce(s.exempt,false)=true THEN
   RETURN jsonb_build_object('success',false,'blocked',true,'reason','exempt','message',CASE WHEN coalesce(s.gender,'male')='female' THEN 'أنتِ معفاة حاليًا من الدخول على المنصة. الرجاء التواصل مع المستر أحمد صابر لإلغاء الإعفاء.' ELSE 'أنتَ معفى حاليًا من الدخول على المنصة. الرجاء التواصل مع المستر أحمد صابر لإلغاء الإعفاء.' END);
 END IF;
 IF coalesce(s.paid,true)=false THEN
   RETURN jsonb_build_object('success',false,'blocked',true,'reason','unpaid','message',CASE WHEN coalesce(s.gender,'male')='female' THEN 'لم يتم سداد رسوم الشهر، لا يمكنكِ الدخول حاليًا.' ELSE 'لم يتم سداد رسوم الشهر، لا يمكنكَ الدخول حاليًا.' END);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'description',x.description,'url',coalesce(x.url,x.video_url,x."Video_ur1",x.file_url),'grade',x.grade) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v FROM public.videos x WHERE coalesce(x.owner_id,s.owner_id)=s.owner_id AND coalesce(x.active,true)=true AND (x.grade IS NULL OR x.grade='' OR x.grade=s.grade);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'grade',x.grade,'duration_minutes',coalesce(x.duration_minutes,x.duration,30),'show_answers',coalesce(x.show_answers,false)) ORDER BY x.created_at DESC),'[]'::jsonb) INTO e FROM public.exams x WHERE coalesce(x.owner_id,s.owner_id)=s.owner_id AND coalesce(x.active,true)=true AND (x.grade IS NULL OR x.grade='' OR x.grade=s.grade);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'body',x.body,'grade',x.grade,'created_at',x.created_at) ORDER BY x.created_at DESC),'[]'::jsonb) INTO a FROM public.announcements x WHERE coalesce(x.owner_id,s.owner_id)=s.owner_id AND coalesce(x.active,true)=true AND (x.grade IS NULL OR x.grade='' OR x.grade=s.grade);
 RETURN jsonb_build_object('success',true,'student',jsonb_build_object('id',s.id,'name',s.name,'student_code',coalesce(nullif(s.student_code,''),s.code),'grade',s.grade,'gender',coalesce(s.gender,'male'),'paid',coalesce(s.paid,true),'exempt',coalesce(s.exempt,false)),'videos',v,'exams',e,'announcements',a);
END; $$;
GRANT EXECUTE ON FUNCTION public.student_portal(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.monthly_attendance_summary(p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_owner uuid; v_start date; v_end date; out_json jsonb;
BEGIN
 v_owner:=auth.uid(); IF v_owner IS NULL THEN RAISE EXCEPTION 'يجب تسجيل دخول المستر أولًا.'; END IF;
 v_start:=date_trunc('month',p_month)::date; v_end:=(v_start+interval '1 month')::date;
 SELECT coalesce(jsonb_agg(jsonb_build_object('student_id',s.id,'student_name',s.name,'student_code',coalesce(nullif(s.student_code,''),s.code),'grade',s.grade,'group_days',s.group_days,'group_time',s.group_time,'gender',coalesce(s.gender,'male'),'exempt',coalesce(s.exempt,false),'present_days',coalesce((select count(*) from public.attendance a1 where a1.student_id=s.id and a1.attendance_date>=v_start and a1.attendance_date<v_end and a1.status='present'),0)::int,'absent_days',coalesce((select count(*) from public.attendance a2 where a2.student_id=s.id and a2.attendance_date>=v_start and a2.attendance_date<v_end and a2.status='absent'),0)::int,'excused_days',coalesce((select count(*) from public.attendance a3 where a3.student_id=s.id and a3.attendance_date>=v_start and a3.attendance_date<v_end and a3.status='excused'),0)::int,'recorded_days',coalesce((select count(*) from public.attendance a4 where a4.student_id=s.id and a4.attendance_date>=v_start and a4.attendance_date<v_end),0)::int) ORDER BY s.name),'[]'::jsonb) INTO out_json FROM public.students s WHERE s.owner_id=v_owner AND coalesce(s.active,true)=true;
 RETURN out_json;
END; $$;
GRANT EXECUTE ON FUNCTION public.monthly_attendance_summary(date) TO authenticated;


-- 8) Teacher-only reset of one student's exam attempt/results.
CREATE OR REPLACE FUNCTION public.reset_student_exam(p_exam_id bigint, p_student_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_owner uuid;
  v_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','يجب تسجيل دخول المستر أولًا.');
  END IF;
  SELECT owner_id INTO v_exam_owner FROM public.exams WHERE id=p_exam_id;
  IF v_exam_owner IS NULL OR v_exam_owner<>auth.uid() THEN
    RETURN jsonb_build_object('success',false,'message','لا توجد صلاحية لإعادة ضبط هذا الامتحان.');
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.exam_attempts WHERE exam_id=p_exam_id AND student_id=p_student_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('success',false,'message','هذا الطالب لا يملك محاولة محفوظة لهذا الامتحان.');
  END IF;
  DELETE FROM public.exam_results WHERE exam_id=p_exam_id AND student_id=p_student_id AND owner_id=auth.uid();
  DELETE FROM public.exam_answers ea USING public.exam_attempts a WHERE ea.attempt_id=a.id AND a.exam_id=p_exam_id AND a.student_id=p_student_id;
  DELETE FROM public.exam_attempts WHERE exam_id=p_exam_id AND student_id=p_student_id;
  RETURN jsonb_build_object('success',true,'message','تم حذف محاولة الطالب ونتيجته، وأصبح بإمكانه دخول الامتحان مرة أخرى.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_student_exam(bigint,bigint) TO authenticated;
