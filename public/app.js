const form=document.getElementById("submission-form");
const statusBox=document.getElementById("form-status");
const submitButton=document.getElementById("submit-button");
const codeInput=document.getElementById("teacherCode");
const teacherCheck=document.getElementById("teacher-check");
let timer;
function showStatus(message,kind){statusBox.textContent=message;statusBox.className=`status show ${kind}`;}
codeInput.addEventListener("input",()=>{
  codeInput.value=codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g,"");
  clearTimeout(timer);
  const code=codeInput.value.trim();
  if(code.length<6){teacherCheck.textContent="Masukkan kode yang diberikan oleh guru.";teacherCheck.style.color="";return;}
  teacherCheck.textContent="Memeriksa kode guru…";
  timer=setTimeout(async()=>{
    try{const r=await fetch(`/api/teacher/${encodeURIComponent(code)}`);const d=await r.json();teacherCheck.textContent=d.ok?`Kode valid — ${d.teacher}`:d.message;teacherCheck.style.color=d.ok?"#286b56":"#9a3022";}
    catch{teacherCheck.textContent="Kode belum bisa diperiksa. Periksa koneksi internet.";}
  },350);
});
form.addEventListener("submit",async e=>{
  e.preventDefault();statusBox.className="status";
  if(!form.reportValidity())return;
  const file=document.getElementById("answer").files[0];
  if(file&&file.size>15*1024*1024){showStatus("Ukuran file maksimal 15 MB.","error");return;}
  submitButton.disabled=true;submitButton.textContent="Mengirim…";
  try{
    const response=await fetch("/api/submit",{method:"POST",body:new FormData(form)});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.message||"Pengiriman gagal.");
    showStatus("Tugas berhasil dikirim ke Google Drive guru. Terima kasih!","success");
    form.reset();teacherCheck.textContent="Masukkan kode yang diberikan oleh guru.";teacherCheck.style.color="";
  }catch(err){showStatus(err.message||"Tugas belum berhasil dikirim. Coba lagi.","error");}
  finally{submitButton.disabled=false;submitButton.textContent="Kirim tugas";}
});
