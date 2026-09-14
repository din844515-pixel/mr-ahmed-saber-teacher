-- MR. Ahmed Saber — FINAL EXAM FORMATS
-- Run once in Supabase SQL Editor.
-- MCQ = automatic correction. All other types = manual correction.
BEGIN;
ALTER TABLE public.exam_questions ADD COLUMN IF NOT EXISTS conversation_data jsonb;

CREATE OR REPLACE FUNCTION public.student_exam(p_code text,p_exam_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; e record; a record; qs jsonb;
BEGIN
 SELECT * INTO s FROM public.students WHERE upper(trim(coalesce(nullif(student_code,''),code)))=upper(trim(p_code)) AND coalesce(active,true)=true LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','كود الطالب غير صحيح'); END IF;
 SELECT * INTO e FROM public.exams WHERE id=p_exam_id AND coalesce(active,true)=true AND (owner_id IS NULL OR owner_id=s.owner_id) AND (grade IS NULL OR grade='' OR grade=s.grade);
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','الامتحان غير متاح لهذا الطالب'); END IF;
 SELECT * INTO a FROM public.exam_attempts WHERE exam_id=e.id AND student_id=s.id LIMIT 1;
 IF FOUND AND a.submitted_at IS NOT NULL THEN RETURN jsonb_build_object('success',false,'message','لقد خضت هذا الامتحان من قبل، ولا يمكن إعادة دخوله.'); END IF;
 IF NOT FOUND THEN INSERT INTO public.exam_attempts(exam_id,student_id,status) VALUES(e.id,s.id,'in_progress') RETURNING * INTO a; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'question',coalesce(q.question,q.question_text,''),'question_type',coalesce(q.question_type,'mcq'),'points',coalesce(q.points,1),'option_a',q.option_a,'option_b',q.option_b,'option_c',q.option_c,'option_d',q.option_d,'position',coalesce(q.position,q.question_order),'conversation_data',q.conversation_data) ORDER BY coalesce(q.position,q.question_order,q.id)),'[]'::jsonb) INTO qs FROM public.exam_questions q WHERE q.exam_id=e.id;
 RETURN jsonb_build_object('success',true,'attempt_id',a.id,'started_at',a.started_at,'student',jsonb_build_object('id',s.id,'name',s.name,'gender',coalesce(s.gender,'male')),'exam',jsonb_build_object('id',e.id,'title',e.title,'duration_minutes',coalesce(e.duration_minutes,e.duration,30),'show_answers',coalesce(e.show_answers,false)),'questions',qs);
END; $$;
GRANT EXECUTE ON FUNCTION public.student_exam(text,bigint) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_exam(p_attempt_id bigint,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a record; s record; e record; q record; chosen text; ok boolean; v_score numeric:=0; v_total numeric:=0; manual_count integer:=0; result_id bigint;
BEGIN
 SELECT * INTO a FROM public.exam_attempts WHERE id=p_attempt_id; IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','المحاولة غير موجودة.'); END IF;
 IF a.submitted_at IS NOT NULL THEN RETURN jsonb_build_object('success',false,'message','تم تسليم الامتحان بالفعل، ولا يمكن إعادته.'); END IF;
 SELECT * INTO s FROM public.students WHERE id=a.student_id AND coalesce(active,true)=true; IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','بيانات الطالب غير موجودة.'); END IF;
 SELECT * INTO e FROM public.exams WHERE id=a.exam_id AND coalesce(active,true)=true; IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','الامتحان غير متاح.'); END IF;
 DELETE FROM public.exam_answers WHERE attempt_id=a.id;
 FOR q IN SELECT * FROM public.exam_questions WHERE exam_id=a.exam_id ORDER BY coalesce(position,question_order,id) LOOP
  v_total:=v_total+coalesce(q.points,1); chosen:=trim(coalesce(p_answers->>q.id::text,''));
  IF lower(coalesce(q.question_type,'mcq')) IN ('essay','written','مقالي','conversation','dialogue','written_group') OR coalesce(q.conversation_data->>'kind','') IN ('reading','story') THEN
   manual_count:=manual_count+1; INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded) VALUES(a.id,q.id,nullif(chosen,''),NULL,0);
  ELSE
   ok:=chosen<>'' AND upper(chosen)=upper(coalesce(q.correct_answer,'')); IF ok THEN v_score:=v_score+coalesce(q.points,1); END IF;
   INSERT INTO public.exam_answers(attempt_id,question_id,answer_text,is_correct,points_awarded) VALUES(a.id,q.id,nullif(chosen,''),ok,CASE WHEN ok THEN coalesce(q.points,1) ELSE 0 END);
  END IF;
 END LOOP;
 UPDATE public.exam_attempts SET submitted_at=now(),score=v_score,total_score=v_total,status='submitted' WHERE id=a.id;
 INSERT INTO public.exam_results(student_id,exam_id,score,total_score,owner_id) VALUES(s.id,e.id,v_score,v_total,e.owner_id) ON CONFLICT (exam_id,student_id) DO UPDATE SET score=EXCLUDED.score,total_score=EXCLUDED.total_score,created_at=now(),owner_id=EXCLUDED.owner_id RETURNING id INTO result_id;
 RETURN jsonb_build_object('success',true,'result_id',result_id,'score',v_score,'total_score',v_total,'manual_count',manual_count);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'message',SQLERRM); END; $$;
GRANT EXECUTE ON FUNCTION public.submit_exam(bigint,jsonb) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.teacher_exam_answers(p_exam_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE result jsonb;
BEGIN IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(row_data ORDER BY student_name,question_order),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('student_id',s.id,'student_name',s.name,'student_gender',coalesce(s.gender,'male'),'submitted_at',a.submitted_at,'attempt_score',coalesce(a.score,0),'attempt_total',coalesce(a.total_score,0),'answer_id',ea.id,'question_id',q.id,'question',coalesce(q.question,q.question_text,''),'question_type',coalesce(q.question_type,'mcq'),'conversation_data',q.conversation_data,'answer_text',ea.answer_text,'is_correct',ea.is_correct,'points',coalesce(q.points,1),'points_awarded',coalesce(ea.points_awarded,0),'question_order',coalesce(q.position,q.question_order,q.id)) row_data,
  s.name student_name,coalesce(q.position,q.question_order,q.id) question_order FROM public.exam_attempts a JOIN public.students s ON s.id=a.student_id JOIN public.exams e ON e.id=a.exam_id JOIN public.exam_questions q ON q.exam_id=e.id LEFT JOIN public.exam_answers ea ON ea.attempt_id=a.id AND ea.question_id=q.id WHERE e.id=p_exam_id AND e.owner_id=auth.uid() AND a.submitted_at IS NOT NULL
 ) x; RETURN result; END; $$;
GRANT EXECUTE ON FUNCTION public.teacher_exam_answers(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.grade_essay_answer(p_answer_id bigint,p_points numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_attempt_id bigint; v_question_id bigint; v_max numeric; v_exam_id bigint; v_student_id bigint; v_owner_id uuid; v_score numeric; v_total numeric;
BEGIN
 SELECT ea.attempt_id,ea.question_id,coalesce(q.points,1),a.exam_id,a.student_id,e.owner_id INTO v_attempt_id,v_question_id,v_max,v_exam_id,v_student_id,v_owner_id FROM public.exam_answers ea JOIN public.exam_attempts a ON a.id=ea.attempt_id JOIN public.exam_questions q ON q.id=ea.question_id JOIN public.exams e ON e.id=a.exam_id WHERE ea.id=p_answer_id AND e.owner_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','الإجابة غير موجودة أو لا توجد صلاحية.'); END IF;
 IF NOT (lower(coalesce((SELECT question_type FROM public.exam_questions WHERE id=v_question_id),'mcq')) IN ('essay','written','مقالي','conversation','dialogue','written_group') OR coalesce((SELECT conversation_data->>'kind' FROM public.exam_questions WHERE id=v_question_id),'') IN ('reading','story')) THEN RETURN jsonb_build_object('success',false,'message','هذا السؤال لا يدعم التصحيح اليدوي.'); END IF;
 IF p_points<0 OR p_points>v_max THEN RETURN jsonb_build_object('success',false,'message','الدرجة خارج نطاق السؤال.'); END IF;
 UPDATE public.exam_answers SET points_awarded=p_points,is_correct=null WHERE id=p_answer_id;
 SELECT coalesce(sum(coalesce(ea.points_awarded,0)),0),coalesce(sum(coalesce(q.points,1)),0) INTO v_score,v_total FROM public.exam_answers ea JOIN public.exam_questions q ON q.id=ea.question_id WHERE ea.attempt_id=v_attempt_id;
 UPDATE public.exam_attempts SET score=v_score,total_score=v_total WHERE id=v_attempt_id;
 UPDATE public.exam_results SET score=v_score,total_score=v_total,created_at=now() WHERE exam_id=v_exam_id AND student_id=v_student_id AND owner_id=v_owner_id;
 RETURN jsonb_build_object('success',true,'score',v_score,'total_score',v_total);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'message',SQLERRM); END; $$;
GRANT EXECUTE ON FUNCTION public.grade_essay_answer(bigint,numeric) TO authenticated;
COMMIT;
