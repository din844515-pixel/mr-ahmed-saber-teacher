-- MR. Ahmed Saber — Reading passage questions
-- Run this once in the CURRENT Supabase project.
-- Adds the JSON data column and makes student/teacher exam RPCs return it.

BEGIN;

ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS conversation_data jsonb;

-- Student exam: return the passage + its sub-questions.
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
    'conversation_data',q.conversation_data,
    'position',coalesce(q.position,q.question_order)
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

-- Teacher answer view: return passage structure with the student's answers.
CREATE OR REPLACE FUNCTION public.teacher_exam_answers(p_exam_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(row_data ORDER BY student_name, question_order), '[]'::jsonb)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'student_id',s.id,'student_name',s.name,'student_gender',COALESCE(s.gender,'male'),
      'submitted_at',a.submitted_at,'attempt_score',COALESCE(a.score,0),'attempt_total',COALESCE(a.total_score,0),
      'answer_id',ea.id,'question_id',q.id,'question',COALESCE(q.question,q.question_text,''),
      'question_type',COALESCE(q.question_type,'mcq'),'conversation_data',q.conversation_data,
      'answer_text',ea.answer_text,'is_correct',ea.is_correct,'points',COALESCE(q.points,1),
      'points_awarded',COALESCE(ea.points_awarded,0),'question_order',COALESCE(q.position,q.question_order,q.id)
    ) AS row_data,
    s.name AS student_name,COALESCE(q.position,q.question_order,q.id) AS question_order
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

COMMIT;
