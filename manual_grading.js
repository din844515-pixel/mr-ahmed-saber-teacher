(function(){
  const originalRenderStudentAnswerGroup = window.renderStudentAnswerGroup;
  const PREP = new Set(['أولى إعدادي','ثانية إعدادي','ثالثة إعدادي']);
  const esc0 = window.esc || (v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  function parseArr(v){ try{ const x=JSON.parse(v||'[]'); return Array.isArray(x)?x:[String(v||'')]; }catch(e){ return v? [String(v)] : []; } }
  function itemsFor(r){
    const cd=(r.conversation_data&&typeof r.conversation_data==='object')?r.conversation_data:{};
    const qt=String(r.question_type||'').toLowerCase();
    if(qt==='conversation'||qt==='dialogue'){
      const qs=Array.isArray(cd.blanks)?cd.blanks:[]; const arr=parseArr(r.answer_text); const grades=Array.isArray(r.manual_grades)?r.manual_grades:[]; const corr=Array.isArray(r.teacher_corrections)?r.teacher_corrections:[];
      return qs.map((x,i)=>({i,text:`الفراغ ${i+1}`,answer:String(arr[i]??'').trim(),max:n(x?.points)||n(r.points)/Math.max(qs.length,1),grade:grades[i],correction:corr[i]||''}));
    }
    const grouped=['reading','story','find_correct','complete','rewrite'].includes(String(cd.kind||'')) || qt==='written_group';
    if(grouped){
      const qs=Array.isArray(cd.questions)?cd.questions:[]; const arr=parseArr(r.answer_text); const grades=Array.isArray(r.manual_grades)?r.manual_grades:[]; const corr=Array.isArray(r.teacher_corrections)?r.teacher_corrections:[];
      return qs.map((x,i)=>({i,text:String(x?.text||`السؤال ${i+1}`),answer:String(arr[i]??'').trim(),max:n(x?.points)||n(r.points)/Math.max(qs.length,1),grade:grades[i],correction:corr[i]||''}));
    }
    const raw=String(r.question||''); const has=/\.{4,}|…{2,}|_{3,}|\[\[\d+\]\]/.test(raw); const arr=parseArr(r.answer_text); const grades=Array.isArray(r.manual_grades)?r.manual_grades:[]; const corr=Array.isArray(r.teacher_corrections)?r.teacher_corrections:[];
    if(has && arr.length>1) return arr.map((a,i)=>({i,text:`الفراغ ${i+1}`,answer:String(a||'').trim(),max:n(r.points)/arr.length,grade:grades[i],correction:corr[i]||''}));
    return [{i:0,text:raw,answer:String(arr[0]??r.answer_text??'').trim(),max:n(r.points)||1,grade:grades[0],correction:corr[0]||''}];
  }
  function manualCard(r, st, i){
    const items=itemsFor(r); const title=String(r.question||'');
    const sub=items.map((x,idx)=>{
      return `<div class="prepManualSubCard" style="margin:10px 0;padding:14px;border:1px solid #e5e7eb;border-radius:14px;background:#fff">
        <div class="prepManualQ"><b>${esc0(x.text)}</b></div>
        <div class="prepManualAnswer" style="margin-top:8px"><span>إجابة ${st.gender==='female'?'الطالبة':'الطالب'}:</span> <strong>${x.answer?esc0(x.answer):'<span class="muted">لم يُجب</span>'}</strong></div>
      </div>`;
    }).join('');
    const max=n(r.points)||items.reduce((a,x)=>a+n(x.max),0)||items.length||1;
    const saved=(Array.isArray(r.manual_grades)&&r.manual_grades.length)?r.manual_grades[0]:'';
    const shown=saved===''||saved===null||saved===undefined?'':n(saved);
    const corr=(Array.isArray(r.teacher_corrections)&&r.teacher_corrections.length)?String(r.teacher_corrections[0]||''):'';
    return `<div class="answerCard prepManualCard">
      <div class="answerHead"><b>${i+1}. ${esc0(title)}</b><span class="badge">تصحيح يدوي</span></div>
      <div class="prepManualAnswers">${sub}</div>
      <div class="prepManualQuestionGrade" style="margin-top:12px;padding:14px;border-top:2px solid #eee">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label><b>الدرجة:</b> <input id="prep_qgrade_${r.answer_id}" type="number" min="0" max="${max}" step="0.5" value="${shown}" placeholder="اكتب الدرجة" style="width:120px;padding:10px;border:1px solid #ccc;border-radius:10px"> <b>من ${max}</b></label>
          <button type="button" ...class="goldAdmin" onclick="saveManualQuestionGrade('${r.answer_id}',${max})">💾 حفظ الدرجة</button>
        </div>
        <div class="prepManualCorrection" style="margin-top:12px"><label><b>تصحيح الخطأ للطالب</b> <span>(اختياري)</span></label>
          <textarea id="prep_qcorr_${r.answer_id}" rows="2" placeholder="اكتب التصحيح هنا لو حبيت..." style="width:100%;box-sizing:border-box;margin-top:6px">${esc0(corr)}</textarea>
        </div>
      </div>
    </div>`;
  }
  function prepRender(st, examTitle){
    st=Object.assign({},st,{grade:st.grade||st.student_grade||st.answers?.[0]?.student_grade||''});
    const ans=st.answers.map((r,i)=>{
      const qt=String(r.question_type||'').toLowerCase();
      if(qt==='mcq') return null; // leave ordinary MCQ to the existing renderer by making a mini student object later
      return manualCard(r,st,i);
    }).filter(Boolean).join('');
    const mcqRows=st.answers.filter(r=>String(r.question_type||'').toLowerCase()==='mcq');
    let auto='';
    if(mcqRows.length){
      auto=mcqRows.map((r,j)=>{
        const awarded=n(r.points_awarded), max=n(r.points)||1;
        let answer=r.answer_text?String(r.answer_text):'لم يُجب';
        return `<div class="answerCard prepAutoCard"><div class="answerHead"><b>اختياري ${j+1}. ${esc0(r.question||'')}</b><span class="badge">اختياري — تصحيح تلقائي</span></div><div class="answerText"><strong>إجابة الطالب:</strong> ${esc0(answer)}</div><div class="autoGrade">${awarded>=max?'✅ إجابة صحيحة':awarded>0?'🟡 إجابة جزئية':'❌ إجابة خاطئة'} <span>(${awarded} / ${max})</span></div></div>`;
      }).join('');
    }
    const pron=st.gender==='female'?'الطالبة':'الطالب';
    const time=st.submitted?`تم التسليم: ${new Date(st.submitted).toLocaleString('ar-EG',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'لم يتم التسليم بعد';
    return `<div class="studentAnswersGroup"><div class="studentAnswersHead"><div><h3>👤 ${esc0(st.name)}</h3><small>${pron} — ${time}${examTitle?` — امتحان: ${esc0(examTitle)}`:''}</small></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end"><strong id="prep_total_${st.student_id}_${st.exam_id}">${n(st.score)} / ${n(st.total)}</strong>${st.student_id&&st.exam_id?`<button class="deleteBtn" onclick="resetStudentExam(${Number(st.exam_id)},${Number(st.student_id)},'${esc0(st.name||'الطالب')}','${esc0(examTitle||'الامتحان')}')">🔄 السماح بإعادة الامتحان</button>`:''}</div></div>${auto}${ans}</div>`;
  }
  window.renderStudentAnswerGroup=function(st, examTitle=''){
    if(PREP.has(String(st.grade||st.student_grade||st.answers?.[0]?.student_grade||''))) return prepRender(st,examTitle);
    return originalRenderStudentAnswerGroup ? originalRenderStudentAnswerGroup(st,examTitle) : '';
  };
  window.saveManualQuestionGrade=async function(answerId,max){
    const input=document.getElementById(`prep_qgrade_${answerId}`); const corr=document.getElementById(`prep_qcorr_${answerId}`);
    if(!input)return; const points=Number(input.value); if(!Number.isFinite(points)||points<0||points>Number(max)){alert(`الدرجة يجب أن تكون بين 0 و ${max}`);return;}
    const btn=input.parentElement?.querySelector('button'); if(btn){btn.disabled=true;btn.textContent='جاري الحفظ...';}
    const {data,error}=await sb.rpc('save_manual_question_grade',{p_answer_id:Number(answerId),p_points:points,p_correction:String(corr?.value||'')});
    if(error||!data?.success){if(btn){btn.disabled=false;btn.textContent='💾 حفظ الدرجة';}alert(error?.message||data?.message||'تعذر حفظ الدرجة.');return;}
    if(btn){btn.disabled=false;btn.textContent='✓ تم الحفظ';}
    const head=input.closest('.studentAnswersGroup')?.querySelector('strong[id^="prep_total_"]'); if(head&&data.total_score!==undefined){ const total=Number(String(head.textContent).split('/')[1])||0; head.textContent=`${Number(data.total_score)} / ${total}`; }
  };
})();
