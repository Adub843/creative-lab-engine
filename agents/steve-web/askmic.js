/* Talk button for the console's Ask box: speak a question to Alice, Steve or Claude. Uses the browser's own
   speech recognition (Chrome, Edge, Safari). The answer is read aloud when the voice button is on. */
(function(){
  const form=document.getElementById("askForm"), input=document.getElementById("askInput"), send=document.getElementById("askBtn");
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!form||!input||!send||!SR||document.getElementById("askMic")) return;
  const b=document.createElement("button"); b.type="button"; b.id="askMic"; b.className="btn"; b.textContent="Talk"; b.title="Talk instead of typing. Press again to send.";
  form.insertBefore(b,send);
  let rec=null, on=false, sendIt=false, base="";
  b.onclick=()=>{
    if(on){ sendIt=true; rec.stop(); return; }
    try{ speechSynthesis.cancel(); }catch(e){}
    rec=new SR(); rec.lang="en-US"; rec.continuous=true; rec.interimResults=true; base=input.value.trim()?input.value.trim()+" ":""; sendIt=false;
    rec.onresult=e=>{ let s=""; for(let i=0;i<e.results.length;i++) s+=e.results[i][0].transcript; input.value=base+s; };
    rec.onerror=e=>{ input.placeholder=e.error==="not-allowed"?"Microphone blocked: allow it for this page.":"Microphone: "+e.error; };
    rec.onend=()=>{ on=false; b.textContent="Talk"; b.classList.remove("primary"); if(sendIt&&input.value.trim()) form.requestSubmit(); };
    try{ rec.start(); on=true; b.textContent="Send"; b.classList.add("primary"); }catch(err){ input.placeholder="Microphone: "+err.message; }
  };
})();
