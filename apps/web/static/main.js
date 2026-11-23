
const top=document.querySelector('.top');
const s=()=>top.classList.toggle('solid',scrollY>40);addEventListener('scroll',s);s();
document.querySelector('.burger').onclick=()=>document.querySelector('.links').classList.toggle('open');
const sh=document.querySelector('.sheet');
document.querySelectorAll('[data-call]').forEach(b=>b.onclick=e=>{e.preventDefault();sh.classList.add('open')});
sh.querySelector('.x').onclick=()=>sh.classList.remove('open');
sh.onclick=e=>{if(e.target===sh)sh.classList.remove('open')};
