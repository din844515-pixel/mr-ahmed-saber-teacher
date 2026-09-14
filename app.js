const SUPABASE_URL="https://gfzzuxzrvysuodehjkyq.supabase.co";
const SUPABASE_KEY="sb_publishable_rb8JsRCgD3ry78YabOfDkQ_G4VCKFko";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,storage:window.localStorage,detectSessionInUrl:true}});
let students=[];

// PWA teacher access: keep teacher entry hidden for students, but available from the same app via ?teacher=1.
function setupTeacherAccess(){
 const btn=document.getElementById("teacherAccess");
 if(btn) btn.classList.remove("teacher-access-hidden");
}
setupTeacherAccess();


function hasInlineBlanks(text){
 const t=String(text||'');
 return /\.{4,}|…{2,}|_{3,}|\[\[\d+\]\]/.test(t);
}
function renderInlineQuestion(text,qid,prefix='inline'){
 const raw=String(text||'');
 let idx=0;
 const normalized=raw.replace(/_{3,}|\.{4,}|…{2,}|\[\[\d+\]\]/g,()=>`[[${++idx}]]`);
 let html=esc(normalized).replace(/\[\[(\d+)\]\]/g,(m,k)=>`<input class="inlineBlank" data-qid="${qid}" data-blank-index="${k}" autocomplete="off" inputmode="text" placeholder="إجابة ${k}">`);
 html=html.replace(/\n/g,'<br>');
 return {html,count:idx};
}
function renderInlineStudentAnswers(text,answerText,qid=''){
 const raw=String(text||'');
 let arr=[]; try{arr=JSON.parse(answerText||'[]');}catch(e){arr=[answerText||''];}
 if(!Array.isArray(arr)) arr=[String(answerText||'')];
 let idx=0;
 const normalized=raw.replace(/_{3,}|\.{4,}|…{2,}|\[\[\d+\]\]/g,()=>`[[${++idx}]]`);
 const html=esc(normalized).replace(/\[\[(\d+)\]\]/g,(m,k)=>{
   const v=String(arr[Number(k)-1]??'').trim();
   return `<span class="inlineAnswerBox${v?' filled':''}">${v?esc(v):'—'}</span>`;
 }).replace(/\n/g,'<br>');
 return html;
}
function collectInlineBlankGroups(){
 const groups={};
 document.querySelectorAll('#examQuestions .inlineBlank').forEach(x=>{
   (groups[x.dataset.qid] ||= []).push([Number(x.dataset.blankIndex),x.value.trim()]);
 });
 Object.entries(groups).forEach(([qid,list])=>{list.sort((a,b)=>a[0]-b[0]);groups[qid]=list.map(x=>x[1]);});
 return groups;
}
function openContactMenu(){
 const choice=prompt("اختاري طريقة التواصل:\n1 - واتساب\n2 - اتصال 01064443212\n3 - اتصال 01278211301", "1");
 if(choice==="1") window.location.href="https://wa.me/201064443212";
 else if(choice==="2") window.location.href="tel:01064443212";
 else if(choice==="3") window.location.href="tel:01278211301";
}

function openLogin(){document.getElementById("login").classList.add("show")}
function initTeacherAccess(){
  const params=new URLSearchParams(window.location.search);
  const teacherMode=params.get("teacher")==="1" || window.location.hash==="#teacher";
  const btn=document.getElementById("teacherAccess");
  if(btn && teacherMode) btn.classList.remove("teacher-access-hidden");
  if(!teacherMode){
    const email=document.getElementById("email");
    if(email) email.value="";
  }
}
function closeLogin(){document.getElementById("login").classList.remove("show")}
function closeDash(){document.getElementById("dash").classList.remove("show")}
function showAdminTab(id,btn){
 document.querySelectorAll(".admin-section").forEach(x=>x.classList.add("hidden"));
 const section=document.getElementById(id);
 if(section) section.classList.remove("hidden");
 document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
 if(btn) btn.classList.add("active");
 if(id==="studentsTab") loadStudents();
 if(["videosTab","examsTab","announcementsTab"].includes(id)) loadContent();
 if(id==="attendanceTab"){
   loadAttendance();
   const m=document.getElementById("attendanceMonth"); if(m && !m.value) m.value=new Date().toISOString().slice(0,7);
 }
 if(id==="resultsTab") loadResults();
}
async function teacherLogin(){
 const email=document.getElementById("email").value.trim(),password=document.getElementById("pass").value,msg=document.getElementById("msg");
 msg.textContent="جاري تسجيل الدخول...";
 const {data,error}=await sb.auth.signInWithPassword({email,password});
 if(error){msg.textContent="بيانات الدخول غير صحيحة أو حدث خطأ.";return}
 closeLogin();document.getElementById("dash").classList.add("show");
 document.getElementById("teacherWelcome").textContent="مرحبًا بك "+(data.user.email||"مستر أحمد")+" 👋";
 loadStudents();
}
async function teacherLogout(){
 await sb.auth.signOut(); closeDash(); document.getElementById("msg").textContent="تم تسجيل الخروج.";
}
function openStudentForm(student=null, presetGrade=""){
 document.getElementById("studentForm").classList.remove("hidden");
 document.getElementById("editStudentId").value=student?.id||"";
 document.getElementById("studentName").value=student?.name||"";
 document.getElementById("studentCodeAdmin").value=student?.student_code||"";
 document.getElementById("studentGrade").value=student?.grade||presetGrade||"";
 document.getElementById("studentPhone").value=student?.phone||"";
 document.getElementById("studentGender").value=student?.gender||"male";
 document.getElementById("studentPaid").value=String(student?.paid ?? true);
 document.getElementById("studentExempt").value=String(student?.exempt ?? false);
 document.getElementById("studentGroupDays").value=student?.group_days||"";
 document.getElementById("studentGroupTime").value=student?.group_time||"";
 document.getElementById("studentFormMsg").textContent="";
}
function cancelStudentForm(){document.getElementById("studentForm").classList.add("hidden")}
function generateStudentCode(){
 const code="AS"+Math.floor(100000+Math.random()*900000);
 document.getElementById("studentCodeAdmin").value=code;
}
async function saveStudent(){
 const {data:{user}}=await sb.auth.getUser();
 if(!user){alert("يجب تسجيل دخول المستر أولًا.");return}
 const id=document.getElementById("editStudentId").value;
 let enteredCode=document.getElementById("studentCodeAdmin").value.trim().toUpperCase();
 if(!enteredCode) { generateStudentCode(); enteredCode=document.getElementById("studentCodeAdmin").value.trim().toUpperCase(); }
 const payload={
  name:document.getElementById("studentName").value.trim(),
  student_code:enteredCode,
  grade:document.getElementById("studentGrade").value,
  phone:document.getElementById("studentPhone").value.trim(),
  gender:document.getElementById("studentGender").value,
  paid:document.getElementById("studentPaid").value==="true",
  exempt:document.getElementById("studentExempt").value==="true",
  payment_status:document.getElementById("studentPaid").value==="true"?"تم السداد":"لم يتم السداد",
  group_days:document.getElementById("studentGroupDays").value.trim(),
  group_time:document.getElementById("studentGroupTime").value.trim()
 };
 const msg=document.getElementById("studentFormMsg");
 if(!payload.name||!payload.student_code){msg.textContent="اكتبي اسم الطالب أولًا.";return}
 msg.textContent="جاري الحفظ...";
 let result;
 if(id) {
   result=await sb.from("students").update(payload).eq("id",id).eq("owner_id",user.id).select("id").single();
 } else {
   // Try a few generated codes if a rare duplicate occurs; this avoids making the teacher solve code collisions manually.
   for(let attempt=0;attempt<5;attempt++){
     result=await sb.from("students").insert({...payload,owner_id:user.id}).select("id").single();
     if(!result.error || result.error.code!=="23505") break;
     generateStudentCode();
     payload.student_code=document.getElementById("studentCodeAdmin").value.trim().toUpperCase();
   }
 }
 if(result.error){
   msg.textContent=result.error.code==="23505"?"الكود مستخدم بالفعل، اختاري كودًا آخر.":"حصل خطأ: "+result.error.message;
   return;
 }
 msg.textContent="تم الحفظ بنجاح ✅";cancelStudentForm();loadStudents();
}
async function loadStudents(){
 const {data:{user}}=await sb.auth.getUser();
 if(!user)return;
 const body=document.getElementById("studentsBody");
 body.innerHTML='<tr><td colspan="5">جاري تحميل الطلاب...</td></tr>';
 const selectFields="id,name,student_code,grade,phone,gender,paid,exempt,payment_status,group_days,group_time,created_at";
 const batchSize=500;
 let all=[], from=0, error=null;
 while(true){
   const res=await sb.from("students").select(selectFields).eq("owner_id",user.id).order("created_at",{ascending:false}).range(from,from+batchSize-1);
   if(res.error){error=res.error;break;}
   all=all.concat(res.data||[]);
   if(!res.data || res.data.length<batchSize) break;
   from+=batchSize;
 }
 if(error){body.innerHTML='<tr><td colspan="5">تعذر تحميل الطلاب. تأكدي من الاتصال بقاعدة البيانات ثم حاولي مرة أخرى.</td></tr>';return}
 students=all;renderStudents();
}
function renderStudents(){
 const q=(document.getElementById("studentSearch")?.value||"").trim().toLowerCase();
 const rows=students.filter(s=>[s.name,s.student_code,s.grade,s.phone,s.group_days,s.group_time].join(" ").toLowerCase().includes(q));
 const grades=["أولى إعدادي","ثانية إعدادي","ثالثة إعدادي","أولى ثانوي","ثانية ثانوي","ثالثة ثانوي"];
 const box=document.getElementById("gradeLists");
 if(!box)return;
 box.innerHTML=grades.map(g=>{
   const arr=rows.filter(s=>(s.grade||"")===g);
   const body=arr.map((s,i)=>`<tr><td>${i+1}</td><td><b>${esc(s.name||"-")}</b></td><td>${esc(s.student_code||"-")}</td><td>${s.paid?"تم السداد":"لم يتم السداد"}</td><td>${s.exempt?"معفى":"غير معفى"}</td><td>${esc(s.group_days||"-")} ${s.group_time?"— "+esc(s.group_time):""}</td><td><button class="editBtn" onclick='openStudentForm(${JSON.stringify(s)})'>تعديل</button> <button class="deleteBtn iconDelete" title="حذف الطالب نهائيًا" aria-label="حذف الطالب" onclick="deleteStudent('${s.id}')">×</button> <button class="editBtn" onclick="openEvaluation('${s.id}')">⭐ تقييم</button></td></tr>`).join("");
   return `<div class="gradeCard"><div class="gradeHead"><h3>📚 ${g} <span class="count">(${arr.length})</span></h3><div class="gradeActions"><button class="goldAdmin" onclick="openStudentForm(null,'${g}')">+ إضافة طالب</button><button class="goldAdmin" onclick="printGradeList('${g}')">📄 طباعة / PDF</button></div></div><div class="tableWrap"><table class="gradeTable"><thead><tr><th>#</th><th>الاسم</th><th>الكود</th><th>السداد</th><th>الإعفاء</th><th>المجموعة</th><th>إجراء</th></tr></thead><tbody>${body||`<tr><td colspan="7" class="gradeEmpty">لا يوجد طلاب في هذه القائمة</td></tr>`}</tbody></table></div></div>`;
 }).join("");
 document.getElementById("studentCount").textContent=`إجمالي الطلاب: ${rows.length}`;
}
function printGradeList(grade){
 const q=(document.getElementById("studentSearch")?.value||"").trim().toLowerCase();
 const arr=students.filter(s=>(s.grade||"")===grade && [s.name,s.student_code,s.grade,s.phone,s.group_days,s.group_time].join(" ").toLowerCase().includes(q));
 const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف طلاب ${esc(grade)}</title><style>body{font-family:Arial,Cairo,sans-serif;padding:28px;color:#111}h1,h2{text-align:center;margin:0 0 8px}h2{margin-bottom:18px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #222;padding:10px;text-align:center}th{background:#eef3f8}.meta{text-align:center;margin-bottom:15px}.note{text-align:center;color:#666;font-size:12px;margin-top:16px}@media print{button{display:none}}</style></head><body><h1>MR. Ahmed Saber</h1><h2>كشف طلاب ${esc(grade)}</h2><div class="meta">عدد الطلاب: ${arr.length} — تاريخ الطباعة: ${new Date().toLocaleDateString("ar-EG")}</div><table><thead><tr><th>م</th><th>اسم الطالب</th><th>كود الطالب</th><th>المجموعة</th><th>الساعة</th><th>السداد</th><th>الإعفاء</th></tr></thead><tbody>${arr.map((st,i)=>`<tr><td>${i+1}</td><td>${esc(st.name||"")}</td><td>${esc(st.student_code||"")}</td><td>${esc(st.group_days||"-")}</td><td>${esc(st.group_time||"-")}</td><td>${st.paid?"تم السداد":"لم يتم السداد"}</td><td>${st.exempt?"معفى":"غير معفى"}</td></tr>`).join("")||'<tr><td colspan="7">لا يوجد طلاب</td></tr>'}</tbody></table><div class="note">اختاري "حفظ بصيغة PDF" من نافذة الطباعة.</div></body></html>`;
 const w=window.open("", "_blank");
 if(!w){alert("المتصفح منع نافذة الطباعة. اسمحي بالنوافذ المنبثقة ثم حاولي مرة أخرى.");return;}
 w.document.open(); w.document.write(html); w.document.close();
 w.focus();
 setTimeout(()=>w.print(),400);
}

async function deleteStudent(id){
 const s=students.find(x=>String(x.id)===String(id));
 if(!s){alert("الطالب غير موجود في القائمة. اضغطي تحديث.");return;}
 const pron=s.gender==='female'?'الطالبة':'الطالب';
 if(!confirm(`هل تريد حذف ${pron} "${s.name||''}" نهائيًا؟\nسيتم حذف الكود وبيانات الحضور والامتحانات والنتائج المرتبطة.`)) return;
 const btn=[...document.querySelectorAll('.iconDelete')].find(b=>b.getAttribute('onclick')?.includes(`'${id}'`));
 if(btn){btn.disabled=true;btn.style.opacity='.55';}
 try{
   const {data:{user},error:authErr}=await sb.auth.getUser();
   if(authErr||!user) throw new Error('يجب تسجيل دخول المستر أولًا.');
   let r=await sb.rpc('delete_student',{p_student_id:Number(id)});
   if(r.error) throw r.error;
   if(!r.data?.success) throw new Error(r.data?.message||'تعذر حذف الطالب.');
   students=students.filter(x=>String(x.id)!==String(id));
   renderStudents();
   alert('تم حذف الطالب وكوده وجميع بياناته المرتبطة بنجاح ✅');
 }catch(err){
   alert('تعذر حذف الطالب: '+(err?.message||err));
 }finally{
   if(btn){btn.disabled=false;btn.style.opacity='1';}
 }
}

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function openEvaluation(id){
 const s=students.find(x=>String(x.id)===String(id)); if(!s)return;
 const {data:ev}=await sb.from("student_evaluations").select("rating,note").eq("student_id",id).single();
 const rating=prompt(`تقييم ${s.name||"الطالب"} من 5 نجوم:`, ev?.rating ?? "5"); if(rating===null)return;
 const note=prompt("ملاحظة لولي الأمر / الطالب:", ev?.note||""); if(note===null)return;
 const r=await sb.rpc("save_student_evaluation",{p_student_id:Number(id),p_rating:Number(rating),p_note:note});
 if(r.error){alert("تعذر حفظ التقييم: "+r.error.message);return;} if(!r.data?.success){alert(r.data?.message||"تعذر حفظ التقييم");return;} alert("تم حفظ التقييم والملاحظة ✅");
}

async function studentLogin(){
 const c=document.getElementById("code").value.trim().toUpperCase();
 if(!c){alert("اكتبي كود الطالب أولًا.");return}
 const {data,error}=await sb.rpc("student_portal",{p_code:c});
 if(error){alert("تعذر الدخول: "+error.message);return}
 if(data?.blocked || data?.reason==='exempt' || data?.reason==='unpaid'){alert(data?.message||"لا يمكن الدخول حاليًا.");return}
 if(!data?.success){alert(data?.message||"كود الطالب غير صحيح.");return}
 localStorage.setItem("student_code",c);
 openStudentPortal(data);
}
async function mediaUrl(url,bucket){
 if(!url)return "";
 if(/^https?:\/\//i.test(url))return url;
 const {data,error}=await sb.storage.from(bucket).createSignedUrl(url,60*60*24);
 return error?"":data?.signedUrl||"";
}
async function openStudentPortal(data){
 document.getElementById("studentPortal")?.remove();
 const st=data.student;
 const videos=await Promise.all((data.videos||[]).map(async v=>({...v,url:await mediaUrl(v.url||v.video_url||v.file_url||v.Video_ur1,"videos")})));
 const m=document.createElement("div"); m.id="studentPortal"; m.className="modal show";
 m.innerHTML=`<div class="studentPortal dashboard"><div class="dashbar"><img src="assets/logo.png"><b>MR. Ahmed Saber</b><button onclick="openContactMenu()">تواصل مع المستر</button><button onclick="studentLogout()">تسجيل خروج</button><button onclick="this.closest('.modal').remove()">×</button></div><div class="dash-title"><div><span>Student Portal</span><h1>أهلًا ${esc(st.name)} 👋</h1><p>الكود: ${esc(st.student_code)} — ${esc(st.grade||'')}</p></div></div><div class="studentPortalGrid">
 <div class="manage-card"><h3>🎥 فيديوهات الشرح</h3><div id="svideos">${(videos||[]).map(v=>`<div class="item"><b>${esc(v.title)}</b><small>${esc(v.grade||'كل الصفوف')}</small>${v.url?`<video controls playsinline preload="metadata" style="width:100%;max-height:280px;border-radius:12px;margin-top:10px" src="${esc(v.url)}"></video>`:'<small>الفيديو غير متاح حاليًا.</small>'}</div>`).join('')||'<small>لا توجد فيديوهات متاحة.</small>'}</div></div>
 <div class="manage-card"><h3>📝 الامتحانات</h3><div id="sexams">${(data.exams||[]).map(e=>`<div class="item"><b>${esc(e.title)}</b><small>${esc(e.grade||'')} — ${e.duration_minutes||30} دقيقة</small><button onclick="startStudentExam('${e.id}')">ابدأ الامتحان</button></div>`).join('')||'<small>لا توجد امتحانات متاحة.</small>'}</div></div>
 <div class="manage-card notificationsCard"><h3>🔔 الإشعارات والإعلانات</h3>${(data.announcements||[]).map(a=>`<div class="notice"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`).join('')||'<small>لا توجد إعلانات.</small>'}</div>
 <div class="manage-card"><h3>⭐ تقييم وملاحظات المستر</h3>${data.evaluation?.rating?`<div class="studentEval"><b>التقييم: ${Number(data.evaluation.rating).toFixed(1)} / 5 ⭐</b><p>${esc(data.evaluation.note||"لا توجد ملاحظة حالياً.")}</p></div>`:'<small>لم يتم إضافة تقييم أو ملاحظة بعد.</small>'}</div>
 </div></div>`;
 document.body.appendChild(m);
}
async function startStudentExam(examId){
 const code=localStorage.getItem("student_code");
 const {data,error}=await sb.rpc("student_exam",{p_code:code,p_exam_id:examId});
 if(error){alert("تعذر فتح الامتحان: "+error.message);return}
 if(!data?.success){alert(data?.message||"الامتحان غير متاح.");return}
 const qs=data.questions||[]; const m=document.createElement("div"); m.id="examModal"; m.className="modal show"; m.dataset.attemptId=String(data.attempt_id||"");
 const questionsHtml=qs.map((q,i)=>{
   const isEssay=['essay','written','مقالي'].includes(String(q.question_type||'mcq').toLowerCase());
   if(isEssay && hasInlineBlanks(q.question)) { const inl=renderInlineQuestion(q.question,q.id); return `<div class="questionCard inlineBlankCard"><b>${i+1}. <span class="inlineQuestionText">${inl.html}</span></b><span class="badge">إجابة كتابية</span></div>`; }
   if(isEssay) return `<div class="questionCard"><b>${i+1}. ${esc(q.question)}</b><span class="badge">سؤال مقالي</span><textarea class="essayAnswer" data-qid="${q.id}" placeholder="اكتب إجابتك هنا..."></textarea></div>`;
   if(hasInlineBlanks(q.question) && String(q.question_type||'mcq').toLowerCase()!=='multi_mcq') { const inl=renderInlineQuestion(q.question,q.id); return `<div class="questionCard inlineBlankCard"><b>${i+1}. <span class="inlineQuestionText">${inl.html}</span></b><span class="badge">إجابة في مكان النقط</span></div>`; }
   const opts=Array.isArray(q.options)&&q.options.length?q.options:['A','B','C','D'].filter(k=>q['option_'+k.toLowerCase()]).map(k=>({key:k,text:q['option_'+k.toLowerCase()]}));
   if(String(q.question_type||'mcq').toLowerCase()==='multi_mcq'){
     return `<div class="questionCard multiMcqCard"><b>${i+1}. ${esc(q.question)}</b><span class="badge">اختار إجابتين صحيحتين</span><small style="display:block;margin:6px 0 10px">مطلوب اختيار إجابتين بالضبط.</small>${opts.map(o=>`<label class="option"><input type="checkbox" name="q_${q.id}[]" value="${esc(o.key)}" onchange="limitMultiMcq(this,2)"> ${esc(o.text)}</label>`).join('')}<div class="multiCount">0 / 2</div></div>`;
   }
   return `<div class="questionCard"><b>${i+1}. ${esc(q.question)}</b>${opts.map(o=>`<label class="option"><input type="radio" name="q_${q.id}" value="${esc(o.key)}"> ${esc(o.text)}</label>`).join('')}</div>`;
 }).join('');
 m.innerHTML=`<div class="studentPortal dashboard examScreen"><div class="dashbar"><img src="assets/logo.png"><b>${esc(data.exam.title)}</b><button onclick="this.closest('.modal').remove()">×</button></div><div class="examMeta">المدة: ${data.exam.duration_minutes||30} دقيقة — الأسئلة: ${qs.length} <strong id="examTimer"></strong></div><div id="examQuestions">${questionsHtml}</div><button class="goldAdmin" data-submit-exam onclick="submitStudentExam('${examId}')">تسليم الامتحان</button></div>`;
 document.body.appendChild(m);
 const startedAt=new Date(data.started_at||Date.now()).getTime(); const totalSecs=(Number(data.exam.duration_minutes)||30)*60; const timer=document.getElementById("examTimer");
 const iv=setInterval(()=>{if(!document.getElementById("examModal")){clearInterval(iv);return;} const secs=Math.max(0,totalSecs-Math.floor((Date.now()-startedAt)/1000)); const mm=Math.floor(secs/60),ss=String(secs%60).padStart(2,"0"); if(timer)timer.textContent=` — الوقت المتبقي ${mm}:${ss}`; if(secs<=0){clearInterval(iv);submitStudentExam(examId,true);}},1000);
}
function limitMultiMcq(el,max=2){ const card=el.closest('.multiMcqCard'); if(!card)return; const checked=[...card.querySelectorAll('input[type=checkbox]')].filter(x=>x.checked); if(checked.length>max){el.checked=false;return;} const count=card.querySelector('.multiCount'); if(count)count.textContent=`${checked.length} / ${max}`; }
async function submitStudentExam(examId,auto=false){
 const code=localStorage.getItem("student_code");
 const modal=document.getElementById("examModal");
 const attemptId=Number(modal?.dataset?.attemptId||0);
 const answers={};
 document.querySelectorAll('#examQuestions input[type=radio]:checked').forEach(x=>answers[x.name.replace('q_','')]=x.value);
 const multiGroups={}; document.querySelectorAll('#examQuestions input[type=checkbox][name$="[]"]:checked').forEach(x=>{const qid=x.name.replace(/^q_|\[\]$/g,'');(multiGroups[qid] ||= []).push(x.value);});
 for(const [qid,list] of Object.entries(multiGroups)){if(list.length!==2){alert('كل سؤال "اختار إجابتين صحيحتين" يجب أن يحتوي على إجابتين بالضبط.');return;} answers[qid]=JSON.stringify(list.sort());}
 for(const el of document.querySelectorAll('#examQuestions .multiMcqCard')){const qid=el.querySelector('input[name$="[]"]')?.name.replace(/^q_|\[\]$/g,'');if(qid&&!answers[qid]){alert('اختاري إجابتين في كل سؤال من نوع "اختار إجابتين صحيحتين".');return;}}
 document.querySelectorAll('#examQuestions textarea[data-qid]').forEach(x=>answers[x.dataset.qid]=x.value.trim());
 const inlineGroups=collectInlineBlankGroups();
 Object.entries(inlineGroups).forEach(([qid,list])=>{answers[qid]=JSON.stringify(list);});
 if(!attemptId){alert('تعذر العثور على محاولة الامتحان. افتحي الامتحان مرة أخرى.');return}
 const submitBtn=modal?.querySelector('[data-submit-exam]');
 if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='جاري تسليم الامتحان...'}
 const {data,error}=await sb.rpc('submit_exam',{p_attempt_id:attemptId,p_answers:answers});
 if(error){if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='تسليم الامتحان'}alert('تعذر تسليم الامتحان: '+error.message);return}
 if(!data?.success){if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='تسليم الامتحان'}alert(data?.message||'تعذر تسليم الامتحان');return}
 const essayMsg=Number(data.essay_count||0)>0?'\nالأسئلة المقالية تحتاج تصحيحًا يدويًا من المستر.':'';
 const female=data?.student?.gender==='female';
 alert(`تم تسليم الامتحان بنجاح ✅\n${female?'درجتك الحالية':'درجتك الحالية'}: ${data.score} من ${data.total_score}${essayMsg}`);
 modal?.remove();
}
async function studentLogout(){
 localStorage.removeItem("student_code");
 document.getElementById("studentPortal")?.remove();
 document.getElementById("code").value="";
 alert("تم تسجيل خروج الطالب. يمكن الدخول بكود آخر.");
}
async function restoreStudentSession(){
 const c=localStorage.getItem("student_code");
 if(!c)return;
 const {data,error}=await sb.rpc("student_portal",{p_code:c});
 if(!error && data?.success) openStudentPortal(data);
 else localStorage.removeItem("student_code");
}
sb.auth.onAuthStateChange((event,session)=>{
 if((event==="SIGNED_IN"||event==="INITIAL_SESSION")&&session){
  document.getElementById("dash").classList.add("show");
  document.getElementById("teacherWelcome").textContent="مرحبًا بك "+(session.user.email||"المستر")+" 👋";
  loadStudents();
  loadContent();
 }
});

async function uploadToBucket(bucket,file){
 const safe=file.name.replace(/[^\w.\-\u0600-\u06FF]/g,"_");
 const path=`${Date.now()}_${safe}`;
 const {error}=await sb.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type||undefined});
 if(error)throw error;
 return path;
}
async function saveVideo(){
 const {data:{user}}=await sb.auth.getUser(); if(!user)return;
 const file=document.getElementById("videoFile")?.files?.[0];
 let url=val("videoUrl");
 try{ if(file) url=await uploadToBucket("videos",file); }catch(e){return alert("فشل رفع الفيديو: "+e.message)}
 const payload={owner_id:user.id,title:val("videoTitle"),url,video_url:url,grade:val("videoGrade")||null,active:true};
 if(!payload.title||!payload.url)return alert("اكتبي عنوان الفيديو واختاري فيديو أو اكتبي رابطه.");
 const {error}=await sb.from("videos").insert(payload); if(error)return alert(error.message);
 ["videoTitle","videoUrl"].forEach(id=>document.getElementById(id).value=""); if(document.getElementById("videoFile"))document.getElementById("videoFile").value=""; loadContent();
}
async function deleteItem(table,id){if(!confirm("حذف هذا العنصر؟"))return;const {data:{user}}=await sb.auth.getUser();const {error}=await sb.from(table).delete().eq("id",id).eq("owner_id",user.id);if(error)alert(error.message);else loadContent();}
async function editContent(table,id){
 const {data:item,error}=await sb.from(table).select("*").eq("id",id).single();
 if(error||!item){alert("تعذر تحميل العنصر");return;}
 const title=prompt("العنوان:",item.title||""); if(title===null)return;
 let body=item.body; if(table==="announcements"){body=prompt("نص الإعلان:",item.body||""); if(body===null)return;}
 const url=table==="videos"?prompt("الرابط/المسار:",item.url||""):null; if(table==="videos"&&url===null)return;
 const patch={title}; if(table==="announcements")patch.body=body; if(url!==null)patch.url=url;
 const {data:{user}}=await sb.auth.getUser(); const {error:e}=await sb.from(table).update(patch).eq("id",id).eq("owner_id",user.id);
 if(e)alert(e.message);else loadContent();
}
async function loadContent(){
 const {data:{user}}=await sb.auth.getUser(); if(!user)return;
 const [v,e,a]=await Promise.all([
   sb.from("videos").select("*").eq("owner_id",user.id).order("created_at",{ascending:false}),
   sb.from("exams").select("*").eq("owner_id",user.id).order("created_at",{ascending:false}).range(0,999),
   sb.from("announcements").select("*").eq("owner_id",user.id).order("created_at",{ascending:false}).range(0,999)
 ]);
 const rawVideos=v.data||[], exams=e.data||[], announcements=a.data||[];
 videos=rawVideos.map(x=>({...x,play_url:x.play_url||x.video_url||x.url||""}));
 const vl=document.getElementById("videosList"); if(vl) vl.innerHTML=videos.map(x=>`<div class="item mediaItem"><b>${esc(x.title)}</b><small>${esc(x.grade||"كل الصفوف")}</small>${x.play_url?`<video controls playsinline preload="metadata" style="width:100%;max-height:320px;border-radius:12px;margin:10px 0;background:#000" src="${esc(x.play_url)}"></video>`:"<small>لم يتم العثور على رابط تشغيل للفيديو.</small>"}<div><button onclick="editContent('videos','${x.id}')">تعديل</button><button onclick="deleteItem('videos','${x.id}')">حذف</button></div></div>`).join("")||"<small>لا توجد فيديوهات.</small>";
 const grades=["أولى إعدادي","ثانية إعدادي","ثالثة إعدادي","أولى ثانوي","ثانية ثانوي","ثالثة ثانوي"];
 const egl=document.getElementById("examGradeLists");
 if(egl){
   egl.innerHTML=grades.map(g=>{
     const arr=exams.filter(x=>(x.grade||"")===g);
     return `<div class="examGradeCard"><div class="examGradeHead"><div><h3>📝 ${esc(g)} <span class="count">(${arr.length})</span></h3><small>يمكن إضافة 100 امتحان وأكثر</small></div><button class="goldAdmin" onclick="presetExamGrade('${g}')">+ امتحان</button></div><div class="examListScroll">${arr.map(x=>`<div class="item examRow"><div class="examMain"><b>${esc(x.title)}</b><small>${x.duration_minutes||x.duration||30} دقيقة — ${x.show_answers?'الإجابات ظاهرة للطالب':'الإجابات مخفية'}</small></div><button onclick="openExamBuilder('${x.id}')">الأسئلة</button><button onclick="openExamAssignmentPicker('${x.id}')">تحديد الطلاب</button><button onclick="editExam('${x.id}')">تعديل</button><button onclick="deleteItem('exams','${x.id}')">حذف</button></div>`).join("")||'<div class="gradeEmpty">لا توجد امتحانات في هذه المرحلة.</div>'}</div></div>`;
   }).join('');
 }
 const al=document.getElementById("announcementsList"); if(al) al.innerHTML=announcements.map(x=>`<div class="item"><b>${esc(x.title)}</b><small>${new Date(x.created_at).toLocaleDateString("ar-EG")}</small><button onclick="deleteItem('announcements','${x.id}')">حذف</button></div>`).join("")||"<small>لا توجد إعلانات.</small>";
}
function presetExamGrade(grade){ const el=document.getElementById('examGrade'); if(el)el.value=grade; document.getElementById('examTitle')?.focus(); }

async function editExam(id){
 const {data:e,error}=await sb.from("exams").select("*").eq("id",id).single(); if(error||!e)return alert("تعذر تحميل الامتحان");
 const title=prompt("اسم الامتحان:",e.title||""); if(title===null)return;
 const durationOptions=[15,20,30,45,60,90,120]; const current=durationOptions.includes(Number(e.duration_minutes))?Number(e.duration_minutes):30; const durationChoice=prompt("اختاري مدة الامتحان:\n1) 15 دقيقة\n2) 20 دقيقة\n3) 30 دقيقة\n4) 45 دقيقة\n5) 60 دقيقة\n6) 90 دقيقة\n7) 120 دقيقة", String(durationOptions.indexOf(current)+1)); if(durationChoice===null)return; const duration=durationOptions[Number(durationChoice)-1]; if(!duration)return alert("اختاري رقمًا من 1 إلى 7.");
 const show=confirm("هل تريدين إظهار الإجابات الصحيحة للطالب بعد الامتحان؟");
 const {data:{user}}=await sb.auth.getUser(); const {error:er}=await sb.from("exams").update({title,duration_minutes:parseInt(duration)||30,show_answers:show}).eq("id",id).eq("owner_id",user.id); if(er)alert(er.message);else loadContent();
}
async function createExam(){
 const {data:{user}}=await sb.auth.getUser();if(!user)return;
 const title=val("examTitle"),grade=val("examGrade"),duration=parseInt(val("examDuration")||"30"),show_answers=val("examShowAnswers")==="true";
 if(!title||!grade)return alert("اكتبي اسم الامتحان واختاري الصف.");
 const {data,error}=await sb.from("exams").insert({owner_id:user.id,title,grade,duration_minutes:duration,show_answers,active:true}).select().single();
 if(error)return alert(error.message);
 document.getElementById("examTitle").value=""; document.getElementById("examDuration").value="30"; document.getElementById("examShowAnswers").value="false";
 await loadContent();
 openExamBuilder(data.id);
 await openExamAssignmentPicker(data.id);
}

async function openExamAssignmentPicker(examId){
 const {data:{user}}=await sb.auth.getUser(); if(!user){alert('يجب تسجيل الدخول أولًا.');return;}
 const {data:exam,error:ee}=await sb.from('exams').select('id,title,grade').eq('id',examId).single();
 if(ee||!exam)return;
 const {data:sts,error:se}=await sb.from('students').select('id,name,student_code,grade,paid,active').eq('owner_id',user.id).eq('grade',exam.grade).order('name',{ascending:true}).range(0,999);
 if(se){alert('تعذر تحميل طلاب المرحلة: '+se.message);return;}
 const {data:assigned,error:ae}=await sb.from('exam_student_assignments').select('student_id').eq('exam_id',examId);
 if(ae){alert('تعذر تحميل التحديدات: '+ae.message);return;}
 const assignedSet=new Set((assigned||[]).map(x=>String(x.student_id)));
 const modal=document.createElement('div'); modal.id='examAssignmentModal'; modal.className='modal show';
 const rows=(sts||[]).map((st,i)=>`<label class="assignmentRow"><input type="checkbox" data-student-id="${st.id}" ${assignedSet.has(String(st.id))?'checked':''}><span class="num">${i+1}</span><b>${esc(st.name||'-')}</b><small>${esc(st.student_code||'')}</small></label>`).join('');
 modal.innerHTML=`<div class="box assignmentBox"><button class="x" onclick="document.getElementById('examAssignmentModal')?.remove()">×</button><h2>تحديد طلاب الامتحان</h2><p><b>${esc(exam.title)}</b> — ${esc(exam.grade)}</p><div class="assignmentTop"><input id="assignmentSearch" placeholder="🔎 ابحثي باسم الطالب أو الكود..." oninput="filterExamAssignments()"><div><button onclick="toggleAllExamAssignments(true)">تحديد الكل</button><button onclick="toggleAllExamAssignments(false)">إلغاء الكل</button></div></div><div id="assignmentList" class="assignmentList">${rows||'<div class="emptyState">لا يوجد طلاب في هذه المرحلة.</div>'}</div><div class="formActions"><button class="goldAdmin" onclick="saveExamAssignments('${examId}')">حفظ التحديد</button><button onclick="document.getElementById('examAssignmentModal')?.remove()">إلغاء</button></div></div>`;
 document.body.appendChild(modal);
}
function filterExamAssignments(){const q=(document.getElementById('assignmentSearch')?.value||'').toLowerCase();document.querySelectorAll('#assignmentList .assignmentRow').forEach(r=>{r.style.display=r.innerText.toLowerCase().includes(q)?'flex':'none';});}
function toggleAllExamAssignments(state){document.querySelectorAll('#assignmentList input[type=checkbox]').forEach(x=>{if(x.closest('.assignmentRow')?.style.display!=='none')x.checked=state;});}
async function saveExamAssignments(examId){
 const selected=[...document.querySelectorAll('#assignmentList input[type=checkbox]:checked')].map(x=>Number(x.dataset.studentId));
 const {error:de}=await sb.from('exam_student_assignments').delete().eq('exam_id',examId); if(de){alert('تعذر تحديث التحديد: '+de.message);return;}
 if(selected.length){const payload=selected.map(student_id=>({exam_id:Number(examId),student_id})); const {error:ie}=await sb.from('exam_student_assignments').insert(payload); if(ie){alert('تعذر حفظ الطلاب المحددين: '+ie.message);return;}}
 document.getElementById('examAssignmentModal')?.remove();
 alert(selected.length?`تم تحديد ${selected.length} طالب/طالبة لهذا الامتحان ✅`:'تم ضبط الامتحان ليكون متاحًا لكل طلاب المرحلة ✅');
}
async function saveAnnouncement(){const {data:{user}}=await sb.auth.getUser();if(!user)return;const payload={owner_id:user.id,title:val("announcementTitle"),body:val("announcementBody"),active:true};if(!payload.title||!payload.body)return alert("اكتبي عنوان ونص الإعلان.");const {error}=await sb.from("announcements").insert(payload);if(error)return alert(error.message);document.getElementById("announcementTitle").value="";document.getElementById("announcementBody").value="";loadContent();}
async function openExamBuilder(examId){
 showAdminTab("examsTab",document.querySelector('[data-tab="examsTab"]'));
 const box=document.getElementById("examBuilder");box.innerHTML="<p>جاري تحميل الأسئلة...</p>";
 const {data:exam}=await sb.from("exams").select("*").eq("id",examId).single();
 const {data:qs}=await sb.from("exam_questions").select("*").eq("exam_id",examId).order("position",{ascending:true});
 box.innerHTML=`<div class="builder" data-exam-id="${examId}"><h3>${esc(exam.title)}</h3><div id="questions">${(qs||[]).map(renderQuestion).join("")}</div><button class="goldAdmin" onclick="addQuestion('${examId}')">+ إضافة سؤال</button></div>`;
}
function gradingModeLabel(q){ return String(q.grading_mode||'auto').toLowerCase()==='manual'?'تصحيح يدوي':'تصحيح تلقائي'; }
function isManualQuestion(q){ return String(q.grading_mode||'auto').toLowerCase()==='manual'; }
function renderQuestion(q){
 const qt=String(q.question_type||'mcq').toLowerCase();
 const raw=String(q.question||q.question_text||'');
 const cd=(q.conversation_data && typeof q.conversation_data==='object')?q.conversation_data:{};
 const kind=String(cd.kind||'').toLowerCase();
 const isReading=kind==='reading'; const isStory=kind==='story'; const isFindCorrect=kind==='find_correct';
 const isComplete=kind==='complete'; const isRewrite=kind==='rewrite';
 const conversation=['conversation','dialogue','محادثة','محادثه'].includes(qt);
 const essay=['essay','written','مقالي'].includes(qt);
 const label=isReading?'قطعة Reading':isStory?'قصة':isFindCorrect?'Find / Correct':isComplete?'Complete':isRewrite?'Rewrite':conversation?'محادثة':essay?'إجابة كتابية':qt==='multi_mcq'?'اختيار إجابتين':'اختياري';
 const mode=gradingModeLabel(q);
 let body='';
 if(isReading||isStory||isFindCorrect||isComplete||isRewrite){
   const qs=Array.isArray(cd.questions)?cd.questions:[];
   const title=isReading?'القطعة':isStory?'القصة':isFindCorrect?'Find / Correct the mistake':isComplete?'Complete the sentences with the correct form of the words in brackets':'Rewrite the following sentences';
   body=`<div class="readingPreview">${isReading||isStory?`<b>${isStory?'القصة':'القطعة'}:</b><div>${esc(cd.passage||cd.story||'')}</div><hr>`:''}<b>${title}:</b>${qs.map((x,i)=>`<div class="readingQPreview">${i+1}. ${esc(x.text||'')} — ${Number(x.points||1)} درجة${q.grading_mode==='auto'&&x.answer?` — الإجابة: ${esc(x.answer)}`:''}</div>`).join('')}</div>`;
 }else if(conversation){
   const blanks=Array.isArray(cd.blanks)?cd.blanks:[]; const tpl=String(cd.template||raw);
   const preview=esc(tpl).replace(/\[\[(\d+)\]\]/g,'<span class="blankBox">______</span>').replace(/_{3,}/g,'<span class="blankBox">______</span>').replace(/\n/g,'<br>');
   body=`<div class="conversationPreview">${preview}</div><small>عدد الفراغات: ${blanks.length} — ${mode}${q.grading_mode==='auto'&&blanks.some(x=>x.answer)?' — تم حفظ الإجابات النموذجية':''}</small>`;
 }else if(essay){
   body=`<small>${mode}${q.grading_mode==='auto'&&q.correct_answer?` — الإجابة النموذجية: ${esc(q.correct_answer)}`:''}</small>`;
 }else if(qt==='multi_mcq'){
   const opts=Array.isArray(q.options)?q.options:[]; body=`<small>${opts.map(o=>`${esc(o.key)}: ${esc(o.text)}`).join(' | ')}</small><br><small>الإجابتان الصحيحتان: ${esc(q.correct_answer||'')}</small>`;
 }else{
   body=`<small>${esc(q.option_a||'')} | ${esc(q.option_b||'')} | ${esc(q.option_c||'')} | ${esc(q.option_d||'')}</small><br><small>${q.grading_mode==='manual'?'سيتم تصحيح اختيار الطالب يدويًا':`الإجابة الصحيحة: ${esc(q.correct_answer||'')}`}</small>`;
 }
 return `<div class="questionItem"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>السؤال ${q.position||q.question_order}</b><span class="badge">${label}</span><span class="badge">${mode}</span><span class="badge">${Number(q.points||1)} درجة</span></div><p>${esc(raw)}</p>${body}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="goldAdmin" onclick="editQuestion('${q.id}')">✏️ تعديل السؤال</button><button onclick="deleteQuestion('${q.id}')">حذف</button></div></div>`;
}

async function editQuestion(id){
 const {data:q,error}=await sb.from('exam_questions').select('*').eq('id',id).single();
 if(error||!q)return alert('تعذر تحميل السؤال.');
 const examId=q.exam_id;
 const qt=String(q.question_type||'mcq').toLowerCase();
 const cd=(q.conversation_data&&typeof q.conversation_data==='object')?q.conversation_data:{};
 const kind=String(cd.kind||'').toLowerCase();
 const manual=String(q.grading_mode||'auto').toLowerCase()==='manual';
 const mode=prompt('طريقة التصحيح؟\n1 - تصحيح تلقائي\n2 - تصحيح يدوي',manual?'2':'1');
 if(mode===null)return; const grading_mode=mode.trim()==='2'?'manual':'auto';
 if(!['1','2'].includes(mode.trim()))return alert('اختاري 1 أو 2.');
 if(qt==='multi_mcq'){
   const ex=await sb.from('exams').select('grade').eq('id',examId).single();
   if(!isSecondaryGrade(ex.data?.grade))return alert('اختيار إجابتين متاح للثانوي فقط.');
   const question=prompt('نص السؤال:',q.question||''); if(question===null||!question.trim())return;
   const oldOpts=Array.isArray(q.options)?q.options:[]; const vals=[];
   for(let i=0;i<5;i++){const key=String.fromCharCode(65+i);const v=prompt(`الاختيار ${key}:`,oldOpts.find(o=>o.key===key)?.text||q['option_'+key.toLowerCase()]||''); if(v===null)return; if(!v.trim())return alert('لازم تكتبي الاختيارات الخمسة.'); vals.push({key,text:v.trim()});}
   if(grading_mode!=='auto')return alert('سؤال اختيار إجابتين لازم يكون تصحيحه تلقائيًا.');
   let correct=prompt('اكتبي حرفي الإجابتين الصحيحتين، مثل A,C:',String(q.correct_answer||'A,B')); if(correct===null)return; correct=correct.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
   if(correct.length!==2||new Set(correct).size!==2||correct.some(x=>!['A','B','C','D','E'].includes(x)))return alert('لازم تختاري حرفين مختلفين من A إلى E.');
   let points=Number(prompt('درجة السؤال:',String(q.points||1))); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
   const {error:er}=await sb.from('exam_questions').update({question:question.trim(),question_text:question.trim(),option_a:vals[0].text,option_b:vals[1].text,option_c:vals[2].text,option_d:vals[3].text,options:vals,correct_answer:correct.sort().join(','),points,grading_mode:'auto'}).eq('id',id).eq('exam_id',examId);
   if(er)alert(er.message); else openExamBuilder(examId); return;
 }
 if(qt==='mcq'){
   const question=prompt('نص السؤال:',q.question||''); if(question===null||!question.trim())return;
   const a=prompt('الاختيار الأول:',q.option_a||''); const b=prompt('الاختيار الثاني:',q.option_b||'');
   const c=prompt('الاختيار الثالث (اختياري):',q.option_c||''); const d=prompt('الاختيار الرابع (اختياري):',q.option_d||'');
   if(!a||!b)return alert('لازم أول اختيارين على الأقل.');
   let correct=q.correct_answer||'A';
   if(grading_mode==='auto'){ correct=prompt('حرف الإجابة الصحيحة A أو B أو C أو D:',correct); if(correct===null)return; correct=correct.trim().toUpperCase(); if(!['A','B','C','D'].includes(correct))return alert('اختاري A أو B أو C أو D.'); }
   let points=Number(prompt('درجة السؤال:',String(q.points||1))); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
   const {error:er}=await sb.from('exam_questions').update({question:question.trim(),question_text:question.trim(),option_a:a,option_b:b,option_c:c,option_d:d,correct_answer:grading_mode==='auto'?correct:null,points,grading_mode}).eq('id',id).eq('exam_id',examId);
   if(er)alert(er.message); else openExamBuilder(examId); return;
 }
 if(qt==='conversation' || kind==='conversation'){
   let template=prompt('نص المحادثة (استخدمي _____ للفراغات):',String(cd.template||q.question||'').replace(/\[\[(\d+)\]\]/g,'_____')); if(template===null||!template.trim())return;
   const matches=template.match(/_{3,}/g)||[]; if(!matches.length)return alert('يجب وجود _____ لكل فراغ.');
   let idx=0; template=template.replace(/_{3,}/g,()=>`[[${++idx}]]`);
   const oldBlanks=Array.isArray(cd.blanks)?cd.blanks:[]; const blanks=[];
   let total=Number(prompt('الدرجة الكاملة للمحادثة:',String(q.points||oldBlanks.reduce((a,x)=>a+Number(x.points||1),0)||matches.length))); if(!Number.isFinite(total)||total<=0)return alert('درجة غير صحيحة.');
   for(let i=0;i<matches.length;i++){
     let pts=Number(prompt(`درجة الفراغ ${i+1}:`,String(oldBlanks[i]?.points||Number((total/matches.length).toFixed(2))))); if(!Number.isFinite(pts)||pts<0)return alert('درجة غير صحيحة.');
     const ans=grading_mode==='auto'?prompt(`الإجابة النموذجية للفراغ ${i+1}:`,oldBlanks[i]?.answer||''):'';
     if(grading_mode==='auto'&&ans===null)return;
     blanks.push({answer:grading_mode==='auto'?(ans||''):'',points:pts});
   }
   const {error:er}=await sb.from('exam_questions').update({question:template,question_text:template,points:total,correct_answer:null,grading_mode,conversation_data:{...cd,kind:'conversation',template,blanks}}).eq('id',id).eq('exam_id',examId);
   if(er)alert(er.message); else openExamBuilder(examId); return;
 }
 if(['reading','story','find_correct','complete','rewrite'].includes(kind) || qt==='written_group'){
   const title=prompt('العنوان:',cd.title||q.question||''); if(title===null||!title.trim())return;
   let passage=cd.passage||cd.story||'';
   if(kind==='reading'||kind==='story'){ passage=prompt(kind==='story'?'نص القصة:':'نص القطعة:',passage); if(passage===null||!passage.trim())return; }
   const arr=Array.isArray(cd.questions)?cd.questions:[]; const questions=[];
   for(let i=0;i<arr.length;i++){
     const text=prompt(`نص السؤال الفرعي ${i+1}:`,arr[i]?.text||''); if(text===null||!text.trim())return;
     const points=Number(prompt(`درجة السؤال الفرعي ${i+1}:`,String(arr[i]?.points||1))); if(!Number.isFinite(points)||points<0)return alert('درجة غير صحيحة.');
     const answer=grading_mode==='auto'?prompt(`الإجابة النموذجية للسؤال الفرعي ${i+1}:`,arr[i]?.answer||''):'';
     if(grading_mode==='auto'&&answer===null)return;
     questions.push({text:text.trim(),points,answer:grading_mode==='auto'?(answer||''):''});
   }
   const total=questions.reduce((a,x)=>a+Number(x.points||0),0);
   const next={...cd,title:title.trim(),questions}; if(kind==='reading'||kind==='story')next.passage=passage.trim();
   const {error:er}=await sb.from('exam_questions').update({question:title.trim(),question_text:title.trim(),points:total,correct_answer:null,grading_mode,conversation_data:next}).eq('id',id).eq('exam_id',examId);
   if(er)alert(er.message); else openExamBuilder(examId); return;
 }
 const question=prompt('نص السؤال:',q.question||''); if(question===null||!question.trim())return;
 const points=Number(prompt('درجة السؤال:',String(q.points||1))); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
 let correct=q.correct_answer||'';
 if(grading_mode==='auto'){ correct=prompt('الإجابة النموذجية:',correct); if(correct===null||!String(correct).trim())return alert('اكتبي الإجابة النموذجية للتصحيح التلقائي.'); }
 const {error:er}=await sb.from('exam_questions').update({question:question.trim(),question_text:question.trim(),points,correct_answer:grading_mode==='auto'?String(correct).trim():null,grading_mode}).eq('id',id).eq('exam_id',examId);
 if(er)alert(er.message); else openExamBuilder(examId);
}

function isSecondaryGrade(grade){return ['أولى ثانوي','ثانية ثانوي','ثالثة ثانوي'].includes(String(grade||'').trim());}
async function addQuestion(examId){
 const {data:examForType}=await sb.from('exams').select('grade').eq('id',examId).single();
 const secondary=isSecondaryGrade(examForType?.grade);
 const type=prompt(`نوع السؤال؟\n1 - اختيار من متعدد\n${secondary?'9 - اختيار إجابتين صحيحتين (للثانوي فقط)\n':''}2 - سؤال إجابة كتابية\n3 - محادثة بفراغات\n4 - قطعة Reading + أسئلة\n5 - قصة + أسئلة\n6 - Find / Correct the mistake\n7 - Complete the sentences with the correct form of the words in brackets\n8 - Rewrite the following sentences`,"1");
 if(type===null)return;
 const t=type.trim();
 const isMulti=t==='9', isEssay=t==='2', isConversation=t==='3', isReading=t==='4', isStory=t==='5', isFindCorrect=t==='6', isComplete=t==='7', isRewrite=t==='8';
 if(isMulti&&!secondary)return alert('اختيار إجابتين متاح للثانوي فقط.');
 if(!['1','2','3','4','5','6','7','8','9'].includes(t))return alert('اختاري من 1 إلى 9.');
 const mode=prompt('طريقة التصحيح؟\n1 - تصحيح تلقائي\n2 - تصحيح يدوي','1'); if(mode===null)return; if(!['1','2'].includes(mode.trim()))return alert('اختاري 1 أو 2.');
 const grading_mode=mode.trim()==='2'?'manual':'auto';
 const question=prompt(isReading?'اكتبي عنوان القطعة:':isStory?'اكتبي عنوان القصة:':isConversation?"اكتبي المحادثة كاملة، واستخدمي _____ مكان كل فراغ.":isFindCorrect?'اكتبي عنوان القسم:':isComplete?'اكتبي عنوان القسم:':isRewrite?'اكتبي عنوان القسم:':"اكتبي نص السؤال:");
 if(question===null || !question.trim())return;
 const {data:old}=await sb.from("exam_questions").select("position").eq("exam_id",examId).order("position",{ascending:false}).limit(1);
 const position=(old?.[0]?.position||0)+1;
 if(isReading||isStory||isFindCorrect||isComplete||isRewrite){
   const isPassage=isReading||isStory;
   const label=isStory?'القصة':isReading?'القطعة':isFindCorrect?'Find / Correct the mistake':isComplete?'Complete the sentences with the correct form of the words in brackets':'Rewrite the following sentences';
   let passage='';
   if(isPassage){ passage=prompt(`اكتبي ${label} كاملة:`); if(passage===null||!passage.trim())return alert(`لازم تكتبي ${label} كاملة.`); }
   const n=Number(prompt(`عدد الأسئلة في ${label}؟`,'5')); if(!Number.isInteger(n)||n<1||n>50)return alert('عدد الأسئلة من 1 إلى 50.');
   const questions=[];
   for(let i=1;i<=n;i++){
     const text=prompt(`السؤال ${i}:`); if(text===null||!text.trim())return;
     const points=Number(prompt(`درجة السؤال ${i}:`,'1')); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
     let answer=''; if(grading_mode==='auto'){ answer=prompt(`الإجابة النموذجية للسؤال ${i}:`); if(answer===null||!answer.trim())return alert('لازم تكتبي الإجابة النموذجية مع التصحيح التلقائي.'); }
     questions.push({text:text.trim(),points,answer});
   }
   const total=questions.reduce((a,x)=>a+Number(x.points||1),0);
   const groupData={kind:isReading?'reading':isStory?'story':isFindCorrect?'find_correct':isComplete?'complete':'rewrite',title:question.trim(),questions};
   if(isPassage)groupData.passage=passage.trim();
   const {error}=await sb.from('exam_questions').insert({exam_id:examId,question:question.trim(),question_text:question.trim(),question_type:'written_group',points:total,correct_answer:null,grading_mode,conversation_data:groupData,position,question_order:position});
   if(error)alert('تعذر حفظ السؤال: '+error.message); else openExamBuilder(examId); return;
 }
 if(isConversation){
   const count=(question.match(/_{3,}/g)||[]).length; if(!count)return alert("لازم تستخدمي _____ لكل فراغ في المحادثة.");
   const points=Number(prompt("الدرجة الكاملة للمحادثة؟",String(count))); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
   let idx=0; const template=question.replace(/_{3,}/g,()=>`[[${++idx}]]`);
   const per=Math.max(0,Number((points/count).toFixed(2))); const blanks=[];
   for(let i=0;i<count;i++){let answer=''; if(grading_mode==='auto'){answer=prompt(`الإجابة النموذجية للفراغ ${i+1}:`); if(answer===null||!answer.trim())return alert('لازم تكتبي كل الإجابات النموذجية.');} blanks.push({answer,points:per});}
   const conversation_data={kind:'conversation',template,blanks};
   const {error}=await sb.from("exam_questions").insert({exam_id:examId,question:template,question_text:template,question_type:'conversation',points,correct_answer:null,grading_mode,conversation_data,position,question_order:position});
   if(error)alert('تعذر حفظ المحادثة: '+error.message);else openExamBuilder(examId); return;
 }
 if(isMulti){
   const questionText=question;
   const a=prompt('الاختيار A:'),b=prompt('الاختيار B:'),c=prompt('الاختيار C:'),d=prompt('الاختيار D:'),e=prompt('الاختيار E:');
   if([a,b,c,d,e].some(x=>!x||!x.trim()))return alert('لازم تكتبي الاختيارات الخمسة.');
   const correct=prompt('اكتبي حرفي الإجابتين الصحيحتين، مثل A,C:','A,B'); if(correct===null)return;
   const keys=correct.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
   if(keys.length!==2||new Set(keys).size!==2||keys.some(x=>!['A','B','C','D','E'].includes(x)))return alert('لازم تختاري حرفين مختلفين من A إلى E.');
   const points=Number(prompt('درجة السؤال:','1')); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
   const options=[{key:'A',text:a.trim()},{key:'B',text:b.trim()},{key:'C',text:c.trim()},{key:'D',text:d.trim()},{key:'E',text:e.trim()}];
   const {error}=await sb.from('exam_questions').insert({exam_id:examId,question:questionText,question_text:questionText,question_type:'multi_mcq',options,option_a:a,option_b:b,option_c:c,option_d:d,correct_answer:keys.sort().join(','),position,question_order:position,points,grading_mode:'auto'});
   if(error)alert('تعذر حفظ السؤال: '+error.message);else openExamBuilder(examId); return;
 }
 if(isEssay){
   const points=Number(prompt("درجة السؤال؟","5")); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
   let correct=null; if(grading_mode==='auto'){correct=prompt('الإجابة النموذجية للتصحيح التلقائي:'); if(correct===null||!correct.trim())return alert('لازم تكتبي الإجابة النموذجية.');}
   const {error}=await sb.from("exam_questions").insert({exam_id:examId,question,question_text:question,question_type:'essay',points,correct_answer:correct,grading_mode,position,question_order:position});
   if(error)alert('تعذر حفظ السؤال: '+error.message);else openExamBuilder(examId); return;
 }
 const a=prompt("الاختيار الأول:"),b=prompt("الاختيار الثاني:"),c=prompt("الاختيار الثالث (اختياري):"),d=prompt("الاختيار الرابع (اختياري):");
 if(!a||!b)return alert('لازم تكتبي أول اختيارين على الأقل.');
 let correct=null; if(grading_mode==='auto'){correct=prompt("اكتبي حرف الإجابة الصحيحة: A أو B أو C أو D","A"); if(correct===null)return; correct=correct.trim().toUpperCase(); if(!['A','B','C','D'].includes(correct))return alert("اختاري A أو B أو C أو D فقط."); if(correct==='C'&&!c||correct==='D'&&!d)return alert("الإجابة الصحيحة يجب أن تكون من الاختيارات المكتوبة.");}
 const points=Number(prompt('درجة السؤال:','1')); if(!Number.isFinite(points)||points<=0)return alert('الدرجة يجب أن تكون أكبر من صفر.');
 const {error}=await sb.from("exam_questions").insert({exam_id:examId,question,question_text:question,question_type:'mcq',option_a:a,option_b:b,option_c:c,option_d:d,correct_answer:correct,position,question_order:position,points,grading_mode});
 if(error)alert('تعذر حفظ السؤال: '+error.message);else openExamBuilder(examId);
}

async function deleteQuestion(id){
 if(!confirm("هل تريدين حذف هذا السؤال نهائيًا؟"))return;
 const btn=[...document.querySelectorAll(".questionItem button")].find(b=>b.getAttribute("onclick")?.includes(`deleteQuestion(\'${id}\')`));
 if(btn){btn.disabled=true;btn.textContent="جاري الحذف...";}
 try{
   const {data:{user},error:authErr}=await sb.auth.getUser();
   if(authErr||!user) throw new Error("يجب تسجيل دخول المستر أولًا.");
   const {data,error}=await sb.rpc("delete_exam_question",{p_question_id:Number(id)});
   if(error) throw error;
   if(!data?.success) throw new Error(data?.message||"تعذر حذف السؤال.");
   const examId=document.querySelector("#examBuilder")?.dataset?.examId;
   if(examId) await openExamBuilder(examId);
   else document.querySelector(".builder")?.remove();
 }catch(err){
   alert("تعذر حذف السؤال: "+(err?.message||err));
   if(btn){btn.disabled=false;btn.textContent="حذف";}
 }
}
function val(id){return document.getElementById(id)?.value.trim()||""}

async function loadAttendance(){
 const body=document.getElementById("attendanceBody"); if(!body)return;
 const dateInput=document.getElementById("attendanceDate");
 if(dateInput&&!dateInput.value) dateInput.value=new Date().toISOString().slice(0,10);
 const date=dateInput?.value||new Date().toISOString().slice(0,10);
 const {data:{user}}=await sb.auth.getUser(); if(!user)return;
 const {data:sts,error:se}=await sb.from("students").select("id,name,grade").eq("owner_id",user.id).order("name");
 if(se){body.innerHTML=`<tr><td colspan="4">تعذر تحميل الطلاب: ${esc(se.message)}</td></tr>`;return}
 const {data:rows,error:ae}=await sb.from("attendance").select("student_id,status").eq("attendance_date",date);
 if(ae){body.innerHTML=`<tr><td colspan="4">تعذر تحميل الحضور: ${esc(ae.message)}</td></tr>`;return}
 const map=Object.fromEntries((rows||[]).map(x=>[String(x.student_id),x.status]));
 body.innerHTML=(sts||[]).map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.grade||"-")}</td><td><select id="att_${s.id}"><option value="present" ${map[String(s.id)]==="present"?"selected":""}>حاضر</option><option value="absent" ${map[String(s.id)]==="absent"?"selected":""}>غائب</option><option value="excused" ${map[String(s.id)]==="excused"?"selected":""}>مُعفى</option></select></td><td><button class="goldAdmin" onclick="saveAttendance('${s.id}')">حفظ</button></td></tr>`).join("")||'<tr><td colspan="4">لا يوجد طلاب.</td></tr>';
}
async function saveAttendance(studentId){
 const date=document.getElementById("attendanceDate")?.value||new Date().toISOString().slice(0,10);
 const status=document.getElementById(`att_${studentId}`)?.value||"present";
 const {error}=await sb.from("attendance").upsert({student_id:studentId,attendance_date:date,status},{onConflict:"student_id,attendance_date"});
 if(error)alert("تعذر حفظ الحضور: "+error.message); else alert("تم الحفظ ✅");
}

async function loadMonthlyAttendance(){
 const box=document.getElementById('monthlyAttendanceBox');
 const input=document.getElementById('attendanceMonth');
 if(!box)return;
 const monthValue=input?.value || new Date().toISOString().slice(0,7);
 const pMonth=monthValue+'-01';
 box.innerHTML='<div class="loadingState">جاري إصدار ملخص الشهر...</div>';
 const {data,error}=await sb.rpc('monthly_attendance_summary',{p_month:pMonth});
 if(error){box.innerHTML=`<div class="errorState">تعذر إصدار الملخص: ${esc(error.message)}</div>`;return;}
 const rows=Array.isArray(data)?data:[];
 if(!rows.length){box.innerHTML='<div class="emptyState">لا توجد بيانات حضور مسجلة لهذا الشهر.</div>';return;}
 let html='<div class="tableWrap"><table><thead><tr><th>الطالب</th><th>الكود</th><th>الصف</th><th>المجموعة</th><th>حضر</th><th>غاب</th><th>إعفاء</th><th>الإجمالي</th></tr></thead><tbody>';
 for(const r of rows){
   html+=`<tr><td><b>${esc(r.student_name||'-')}</b></td><td><span class="codeBadge">${esc(r.student_code||'-')}</span></td><td>${esc(r.grade||'-')}</td><td>${esc(r.group_days||'-')} ${r.group_time?'— '+esc(r.group_time):''}</td><td style="color:#15803d;font-weight:700">${Number(r.present_days||0)}</td><td style="color:#dc2626;font-weight:700">${Number(r.absent_days||0)}</td><td style="color:#b7791f;font-weight:700">${Number(r.excused_days||0)}${r.exempt?' ⭐ معفى':''}</td><td>${Number(r.recorded_days||0)}</td></tr>`;
 }
 html+='</tbody></table></div>';
 html+='<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="goldAdmin" onclick="downloadMonthlyAttendance()">⬇️ تنزيل تقرير الشهر</button><span class="count">عدد الطلاب: '+rows.length+'</span></div>';
 box.innerHTML=html;
 box.dataset.rows=JSON.stringify(rows); box.dataset.month=monthValue;
}
function downloadMonthlyAttendance(){
 const box=document.getElementById('monthlyAttendanceBox');
 const rows=JSON.parse(box?.dataset?.rows||'[]');
 if(!rows.length){alert('أصدري الملخص أولًا.');return;}
 const month=box.dataset.month||'';
 const lines=[['الطالب','الكود','الصف','المجموعة','حضر','غاب','إعفاء','الأيام المسجلة']];
 rows.forEach(r=>lines.push([r.student_name||'',r.student_code||'',r.grade||'',`${r.group_days||''} ${r.group_time||''}`.trim(),r.present_days||0,r.absent_days||0,r.excused_days||0,r.recorded_days||0]));
 const csv='\ufeff'+lines.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`attendance_${month}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

async function loadResults(){
 const {data:{user}}=await sb.auth.getUser();if(!user)return;
 const [rr,ee,aa]=await Promise.all([
   sb.from("exam_results").select("id,score,total_score,created_at,student_id,exam_id,students(name,grade),exams(title,grade)").eq("owner_id",user.id).order("created_at",{ascending:false}).range(0,999),
   sb.from("exams").select("id,title,grade").eq("owner_id",user.id).order("created_at",{ascending:false}).range(0,999),
   sb.from("exam_attempts").select("id,exam_id,student_id,submitted_at,owner_id").eq("owner_id",user.id).not("submitted_at","is",null).order("submitted_at",{ascending:false}).range(0,1999)
 ]);
 const data=(rr.data||[]).map(r=>{const a=(aa.data||[]).find(x=>Number(x.exam_id)===Number(r.exam_id)&&Number(x.student_id)===Number(r.student_id));return {...r,submitted_at:a?.submitted_at||r.created_at};}), exams=ee.data||[];
 const grades=["أولى إعدادي","ثانية إعدادي","ثالثة إعدادي","أولى ثانوي","ثانية ثانوي","ثالثة ثانوي"];
 const box=document.getElementById('resultGradeLists');
 if(box){
   box.innerHTML=grades.map(g=>{
     const rows=data.filter(r=>(r.exams?.grade||r.students?.grade||"")===g);
     const ex=exams.filter(e=>(e.grade||"")===g);
     return `<div class="resultGradeCard"><div class="resultGradeHead"><div><h3>🏆 نتائج ${esc(g)} <span class="count">(${rows.length})</span></h3><small>اضغطي على اسم الطالب لفتح امتحانه وتصحيح إجاباته</small></div><select onchange="quickExamAnswers(this.value)"><option value="">إجابات امتحان من هذه المرحلة</option>${ex.map(e=>`<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select></div><div class="resultScroll"><table><thead><tr><th>الطالب</th><th>الامتحان</th><th>الدرجة</th><th>التاريخ</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="resultStudentBtn" onclick="openStudentResult(${Number(r.student_id)},${Number(r.exam_id)},'${esc(r.students?.name||'الطالب')}','${esc(r.exams?.title||'الامتحان')}')">👤 ${esc(r.students?.name||'-')}</button><button class="deleteBtn" onclick="resetStudentExam(${Number(r.exam_id)},${Number(r.student_id)},'${esc(r.students?.name||'الطالب')}','${esc(r.exams?.title||'الامتحان')}')">🔄 إعادة الامتحان</button></td><td>${esc(r.exams?.title||'-')}</td><td><strong>${Number(r.score||0)}/${Number(r.total_score||0)}</strong></td><td>${r.submitted_at?new Date(r.submitted_at).toLocaleString('ar-EG',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'-'}</td></tr>`).join('')||'<tr><td colspan="4" class="gradeEmpty">لا توجد نتائج لهذه المرحلة حتى الآن.</td></tr>'}</tbody></table></div></div>`;
   }).join('');
 }
 const body=document.getElementById('resultsBody'); if(body)body.innerHTML='';
 const sel=document.getElementById("answersExamSelect");
 if(sel) sel.innerHTML='<option value="">اختاري الامتحان لعرض إجابات الطلاب</option>'+exams.map(e=>`<option value="${e.id}">${esc(e.title)}${e.grade?` — ${esc(e.grade)}`:""}</option>`).join('');
}
function quickExamAnswers(id){ const sel=document.getElementById('answersExamSelect'); if(sel){sel.value=id;loadExamAnswers();} }

async function openStudentResult(studentId, examId, studentName='', examTitle=''){
 const sel=document.getElementById('answersExamSelect'); if(sel) sel.value=String(examId);
 const box=document.getElementById('examAnswersBox'); if(!box)return;
 box.innerHTML=`<div class="loadingState">جاري تحميل إجابات ${esc(studentName||'الطالب')}...</div>`;
 const {data,error}=await sb.rpc('teacher_exam_answers',{p_exam_id:Number(examId)});
 if(error){box.innerHTML=`<div class="errorState">تعذر تحميل الإجابات: ${esc(error.message)}</div>`;return;}
 const rows=(Array.isArray(data)?data:[]).filter(r=>String(r.student_id)===String(studentId));
 if(!rows.length){box.innerHTML='<div class="emptyState">لا توجد إجابات محفوظة لهذا الطالب في هذا الامتحان.</div>';return;}
 renderStudentAnswerGroups(rows, studentName, examTitle);
 document.getElementById('examAnswersBox')?.scrollIntoView({behavior:'smooth',block:'start'});
}

async function loadExamAnswers(){
 const examId=document.getElementById('answersExamSelect')?.value;
 const box=document.getElementById('examAnswersBox');
 if(!box)return;
 if(!examId){box.innerHTML='<div class="emptyState">اختاري امتحانًا أولًا لعرض إجابات الطلاب.</div>';return;}
 box.innerHTML='<div class="loadingState">جاري تحميل إجابات الطلاب...</div>';
 const {data,error}=await sb.rpc('teacher_exam_answers',{p_exam_id:Number(examId)});
 if(error){box.innerHTML=`<div class="errorState">تعذر تحميل الإجابات: ${esc(error.message)}</div>`;return;}
 const rows=Array.isArray(data)?data:[];
 if(!rows.length){box.innerHTML='<div class="emptyState">لا توجد إجابات مسجلة لهذا الامتحان حتى الآن.</div>';return;}
 const byStudent={};
 rows.forEach(r=>{(byStudent[r.student_id] ||= {name:r.student_name,gender:r.student_gender,score:r.attempt_score,total:r.attempt_total,submitted:r.submitted_at,student_id:r.student_id,exam_id:r.exam_id,answers:[]}).answers.push(r)});
 box.innerHTML=Object.values(byStudent).map(st=>renderStudentAnswerGroup(st)).join('');
}

function renderStudentAnswerGroups(rows, forcedName='', examTitle=''){
 const first=rows[0]||{};
 const st={name:forcedName||first.student_name,gender:first.student_gender,score:first.attempt_score,total:first.attempt_total,submitted:first.submitted_at,student_id:first.student_id,exam_id:first.exam_id,answers:rows};
 const box=document.getElementById('examAnswersBox'); if(box) box.innerHTML=renderStudentAnswerGroup(st,examTitle);
}
function renderStudentAnswerGroup(st, examTitle=''){
 const pron=st.gender==='female'?'الطالبة':'الطالب';
 const ans=st.answers.map((r,i)=>{
   const qt=String(r.question_type||'').toLowerCase(); const manual=String(r.grading_mode||'auto').toLowerCase()==='manual'; const essay=['essay','written','مقالي'].includes(qt); const cd=typeof r.conversation_data==='object'&&r.conversation_data?r.conversation_data:{}; const reading=cd.kind==='reading'; const story=cd.kind==='story'; const findCorrect=cd.kind==='find_correct'; const complete=cd.kind==='complete'; const rewrite=cd.kind==='rewrite'; const grouped=reading||story||findCorrect||complete||rewrite||qt==='written_group'; const conversation=['conversation','dialogue','محادثة','محادثه'].includes(qt)||/\[\[\d+\]\]|_{3,}/.test(String(r.question||''));
   let answer='';
   if(grouped){
     let arr=[]; try{arr=JSON.parse(r.answer_text||'[]')}catch(e){arr=[r.answer_text||''];}
     const rqs=Array.isArray(cd.questions)?cd.questions:[];
     answer=`<div class="${story?'storyStudentAnswer':'readingStudentAnswer'}">${(reading||story)?`<b>${story?'القصة':'القطعة'}:</b><div>${esc(cd.passage||cd.story||'')}</div>`:''}<b>${findCorrect?'Find / Correct the mistake':complete?'Complete the sentences with the correct form of the words in brackets':rewrite?'Rewrite the following sentences':'الأسئلة'}:</b>${rqs.map((x,j)=>`<div class="readingAnsRow"><b>${j+1}. ${esc(x.text||'')}</b><br>إجابة الطالب: ${arr[j]?esc(arr[j]):'<span class="muted">لم يُجب</span>'}</div>`).join('')}</div>`;
   } else if(conversation){ let arr=[]; try{arr=JSON.parse(r.answer_text||'[]')}catch(e){arr=[r.answer_text||''];} answer=arr.map((a,j)=>`<div><b>الفراغ ${j+1}:</b> ${a?esc(a):'<span class="muted">لم يُجب</span>'}</div>`).join('')||'<span class="muted">لم يُجب</span>'; } else if(hasInlineBlanks(r.question)){ answer=renderInlineStudentAnswers(r.question,r.answer_text,r.question_id); } else answer=r.answer_text?esc(r.answer_text):'<span class="muted">لم يُجب</span>';
   const max=Number(r.points||1);
   const awarded=Number(r.points_awarded||0);
   const hasAnswer=!!r.answer_id && String(r.answer_text||'').trim()!=='';
   const partial=hasAnswer && awarded>0 && awarded<max;
   const autoStatus=partial?'🟡 إجابة جزئية':(!hasAnswer?'— لم تتم الإجابة':awarded>=max?'✅ إجابة صحيحة':'❌ إجابة خاطئة');
   const isMulti=qt==='multi_mcq';
   let subStatus='';
   if(isMulti){
     let keys=[]; try{keys=JSON.parse(r.answer_text||'[]')}catch(e){keys=String(r.answer_text||'').split(',').map(x=>x.trim()).filter(Boolean)}
     const opts=Array.isArray(r.options)?r.options:[];
     const selected=keys.map(k=>{const o=opts.find(x=>String(x.key).toUpperCase()===String(k).toUpperCase());return o?`${esc(o.key)}: ${esc(o.text)}`:esc(k)}).join(' + ')||'<span class="muted">لم يُجب</span>';
     const correctKeys=String(r.correct_answer||'').split(',').map(x=>x.trim()).filter(Boolean).join(' + ');
     subStatus=`<div class="multiTeacherDetails"><div><b>اختيارات ${pron}:</b> ${selected}</div><div><b>الإجابتان الصحيحتان:</b> ${esc(correctKeys||'-')}</div></div>`;
   }
   if(grouped && Array.isArray(cd.questions)){
     let arr=[]; try{arr=JSON.parse(r.answer_text||'[]')}catch(e){}
     subStatus+=`<div class="subGradeList">${cd.questions.map((x,j)=>{const pts=Number(x.points||1);const a=String(arr[j]||'').trim();const expected=String(x.answer||'').trim();const norm=v=>v.toLowerCase().replace(/[\p{P}]/gu,'').replace(/\s+/g,' ').trim();const ok=!!a&&!!expected&&norm(a)===norm(expected);return `<div class="subGradeRow"><span>(${j+1}) ${ok?'✅ صحيح':a?'❌ خطأ':'— لم يُجب'}</span><span>${ok?pts:0} / ${pts}</span></div>`;}).join('')}</div>`;
   }
   const feedbackEditor=r.answer_id?`<div class="feedbackEditor"><b>📝 تصحيح الخطأ للطالب</b><textarea id="wrong_${r.answer_id}" placeholder="اكتب الإجابة التي أخطأ فيها الطالب..." rows="2">${esc(r.wrong_answer||'')}</textarea><textarea id="correct_${r.answer_id}" placeholder="اكتب الإجابة الصحيحة..." rows="2">${esc(r.feedback_correct_answer||'')}</textarea><textarea id="note_${r.answer_id}" placeholder="ملاحظة للطالب (اختياري)..." rows="2">${esc(r.note||'')}</textarea><button class="goldAdmin" onclick="saveFeedback('${r.answer_id}')">💾 حفظ التصحيح</button></div>`:'';
   const manualGrade=manual&&r.answer_id?`<div class="essayGradeRow"><span>الدرجة: <b>${awarded}</b> / ${max}</span><input id="grade_${r.answer_id}" type="number" min="0" max="${max}" step="0.5" value="${awarded}" placeholder="الدرجة"><button class="goldAdmin" onclick="gradeEssay('${r.answer_id}',${max})">حفظ الدرجة</button></div>`:'';
   return `<div class="answerCard"><div class="answerHead"><b>${i+1}. ${esc(r.question)}</b><span class="badge">${isMulti?'اختيار إجابتين':reading?'قطعة Reading':story?'قصة':findCorrect?'Find / Correct':complete?'Complete':rewrite?'Rewrite':conversation?'محادثة':essay?'إجابة يدوية':'اختياري'}</span></div><div class="answerText"><strong>إجابة ${pron}:</strong> ${answer}</div>${subStatus}${manualGrade}${manual?'':`<div class="autoGrade">${autoStatus} <span>(${awarded} / ${max})</span></div>`}${feedbackEditor}</div>`;
 }).join('');
 return `<div class="studentAnswersGroup"><div class="studentAnswersHead"><div><h3>👤 ${esc(st.name)}</h3><small>${pron} — ${st.submitted?`تم التسليم: ${new Date(st.submitted).toLocaleString('ar-EG',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'لم يتم التسليم بعد'}${examTitle?` — امتحان: ${esc(examTitle)}`:''}</small></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end"><strong>${Number(st.score||0)} / ${Number(st.total||0)}</strong>${st.student_id&&st.exam_id?`<button class="deleteBtn" onclick="resetStudentExam(${Number(st.exam_id)},${Number(st.student_id)},'${esc(st.name||'الطالب')}','${esc(examTitle||'الامتحان')}')">🔄 السماح بإعادة الامتحان</button>`:''}</div></div>${ans}</div>`;
}

async function resetStudentExam(examId, studentId, studentName='', examTitle='') {
 if(!confirm(`هل تريد حذف محاولة ${studentName||'الطالب'} في امتحان ${examTitle||'الامتحان'}؟\nسيتم حذف المحاولة وإجاباتها والنتيجة، وبعدها يستطيع الطالب دخول الامتحان من جديد.`)) return;
 const btns=[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('السماح بإعادة الامتحان'));
 btns.forEach(b=>{b.disabled=true;b.textContent='جاري إعادة الضبط...';});
 const {data,error}=await sb.rpc('reset_student_exam',{p_exam_id:Number(examId),p_student_id:Number(studentId)});
 if(error){btns.forEach(b=>{b.disabled=false;b.textContent='🔄 السماح بإعادة الامتحان';});alert('تعذر حذف المحاولة: '+error.message);return;}
 if(!data?.success){btns.forEach(b=>{b.disabled=false;b.textContent='🔄 السماح بإعادة الامتحان';});alert(data?.message||'تعذر حذف المحاولة.');return;}
 alert('تم حذف محاولة الطالب ونتيجته، وأصبح بإمكانه دخول الامتحان مرة أخرى ✅');
 const box=document.getElementById('examAnswersBox');
 if(box) box.innerHTML='<div class="emptyState">تمت إعادة ضبط الامتحان لهذا الطالب ✅</div>';
 await loadResults();
}

async function saveFeedback(answerId){
 const wrong=document.getElementById(`wrong_${answerId}`)?.value||''; const correct=document.getElementById(`correct_${answerId}`)?.value||''; const note=document.getElementById(`note_${answerId}`)?.value||'';
 const btn=document.getElementById(`correct_${answerId}`)?.parentElement?.querySelector('button');
 if(btn){btn.disabled=true;btn.textContent='جاري الحفظ...';}
 const {data,error}=await sb.rpc('save_exam_answer_feedback',{p_answer_id:Number(answerId),p_wrong_answer:wrong,p_correct_answer:correct,p_note:note});
 if(error||!data?.success){if(btn){btn.disabled=false;btn.textContent='💾 حفظ التصحيح';}alert(error?.message||data?.message||'تعذر حفظ التصحيح.');return;}
 if(btn){btn.disabled=false;btn.textContent='✓ تم حفظ التصحيح';}
}

async function gradeEssay(answerId,max){
 const input=document.getElementById(`grade_${answerId}`); if(!input)return;
 const points=Number(input.value);
 if(!Number.isFinite(points)||points<0||points>max){alert(`الدرجة يجب أن تكون بين 0 و ${max}`);return;}
 const btn=input.parentElement?.querySelector('button');
 if(btn){btn.disabled=true;btn.textContent='جاري الحفظ...';}
 const {data,error}=await sb.rpc('grade_essay_answer',{p_answer_id:Number(answerId),p_points:points});
 if(error){if(btn){btn.disabled=false;btn.textContent='حفظ الدرجة';} alert('تعذر حفظ الدرجة: '+error.message);return;}
 if(!data?.success){if(btn){btn.disabled=false;btn.textContent='حفظ الدرجة';} alert(data?.message||'تعذر حفظ الدرجة.');return;}
 // لا نعيد تحميل قائمة الإجابات حتى لا تُغلق/تتغير الأسئلة أثناء التصحيح.
 const row=input.closest('.essayGradeRow');
 if(row){
   const label=row.querySelector('span');
   if(label) label.innerHTML=`الدرجة: <b>${points}</b> / ${max}`;
   if(btn){btn.disabled=false;btn.textContent='✓ تم الحفظ';}
 }
 // تحديث إجمالي الطالب الظاهر بدون إعادة بناء الصفحة.
 const group=input.closest('.studentAnswersGroup');
 const totalEl=group?.querySelector('.studentAnswersHead strong');
 if(totalEl && data.score!=null && data.total_score!=null) totalEl.textContent=`${Number(data.score)} / ${Number(data.total_score)}`;
}

window.addEventListener("DOMContentLoaded",()=>{ initTeacherAccess(); restoreStudentSession(); });

window.addEventListener("DOMContentLoaded",()=>{ 
  const login=document.getElementById("login");
  if(login) login.classList.add("show");
});
