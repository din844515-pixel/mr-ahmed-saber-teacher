-- Mr. Ahmed Saber platform: Multi-MCQ secondary-school partial grading + teacher feedback visibility
-- Production database migration already applied separately.

CREATE OR REPLACE FUNCTION public.submit_exam(p_attempt_id bigint,p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $function$
-- Production definition: multi_mcq awards full points for 2/2 correct,
-- half points for exactly 1/2 correct, and 0 otherwise.
-- Automatic-only exams are marked graded immediately; exams with manual items stay submitted.
BEGIN
  RAISE EXCEPTION 'This file documents the already-applied production function; rerun the deployed migration instead of this stub.';
END;
$function$;
