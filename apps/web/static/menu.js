
const K=[
 {t:"Rice & Sides",g:[
  {h:"Rice dishes",n:"Per portion",i:[["Jollof Rice",700],["Fried Rice",700],["White Rice",500],["Ofada Rice",700],["Coconut Rice",1000],["Village Rice",900],["Rice and Beans",700]]},
  {h:"Other meals & sides",n:"Per portion",i:[["Yam Porridge",900],["Beans Porridge",500],["Spaghetti",500],["Plantain",500],["Moi Moi",700],["Sausage",500],["Yam",500],["Ewa Agoyin",300],["Egg Sauce",1000],["Ofada Sauce",1000]]}]},
 {t:"Swallow & Soups",g:[
  {h:"Swallow",n:"Per portion",i:[["Amala",500],["Eba",300],["Semo",300],["Fufu",300],["Pounded Yam",600]]},
  {h:"Soups",n:"Per portion",i:[["Edikaikong Soup",1000],["Egusi Soup",700],["Efo Riro",700],["Okra Soup",700],["Ogbono Soup",800]]},
  {h:"Pepper soup",i:[["Assorted Pepper Soup",2500],["Catfish Pepper Soup",null]]}]},
 {t:"Meat & Poultry",g:[
  {h:"Beef & meat",i:[["Beef",500],["Assorted Meat",800],["Ponmo",500],["Peppered Ponmo",500],["Goat Meat",3000],["Bokoto",2000]]},
  {h:"Chicken",i:[["Small",4000],["Medium",5000],["Large",6000]]},
  {h:"Turkey",i:[["Small",4000],["Medium",5000],["Large",6000]]},
  {h:"Gizzard",i:[["Small",1000],["Medium",1500],["Large",2000],["Gizzard Dodo",1500]]}]},
 {t:"Fish",g:[
  {h:"Fish",i:[["Owere Fish",4000],["Panla Fish",3000],["Croaker Fish",5000],["Titus Fish, small",3500],["Titus Fish, large",4000],["Tilapia Fish, small",3000],["Tilapia Fish, large",4000]]}]},
 {t:"Soup Bowls & Stews",g:[
  {h:"Seafood okra soup",n:"Semo or eba included",i:[["Premium Bowl",20000,"2 snails, 2 prawns, 2 crabs & 2 fish"],["Regular Bowl",15000,"1 snail, 1 prawn, 1 crab & 1 fish"]]},
  {h:"Soup bowls (1 litre)",n:"Semo or eba included",i:[["Okra Soup Bowl",20000,"With snail, prawn, crab & fish"],["Okra Soup with Snail",15000],["Ogbono Soup",10000,"With beef, ponmo and semo or eba"],["Egusi Soup",15000,"With beef, ponmo and semo or eba"],["Okra Soup",10000,"2 assorted meat, 1 beef, 1 bokoto, dry fish & ponmo"],["Efo Riro",15000,"With beef, ponmo and semo or eba"],["Edikaikong Soup",25000]]},
  {h:"Stews & sauces (1 litre)",i:[["Chicken Stew",20000],["Turkey Stew",25000],["Ofada Sauce",10000,"Includes 2 eggs, assorted meat and beef"]]}]},
 {t:"Snacks & Combos",g:[
  {h:"Snacks",i:[["Hamburger",2500],["Chin Chin",2700],["Small Chops",2500]]},
  {h:"Combo packages",i:[["Hamburger & Coke",3000],["Shawarma & Coke",4000],["Jollof Rice, Coke & Beef",2500],["Fried Rice, Coke & Chicken",3500]]}]}];
const D=[
  {h:"Soft drinks",i:[["Coca-Cola",600],["Fanta",600],["Sprite",600],["Can Coca-Cola",700],["Can Fanta",700],["Can Schweppes",700],["Malt",1000],["Monster Energy",1500],["Lucozade",1500]]},
  {h:"Juices & fruit drinks",i:[["Fayrouz",1000],["Fresh Yo",1000],["Fruit Yo",800],["Fruit Juice",3000],["Exotic, small",1000],["Exotic, big",2500],["5 Alive, small",1000],["5 Alive, big",2000],["Sosa",2000],["Active",2500],["Active, can",1000]]},
  {h:"Milk & yoghurt",i:[["Nutri Choco",1000],["Nutri Milk",1000],["Viju Choco",1500],["Viju Wheat",1500],["Cedaa",1500],["Zoi Dairy Yoghurt",2500],["Hollandia",3000],["Vitamilk",3000],["Viju-Smartic",3000],["Viju Wheat, large",3000]]},
  {h:"Local drinks & water",i:[["Zobo",2500],["Tiger Nut Drink",null],["Water",300],["Eva Water",600]]}];
const f=v=>v==null?'Call for price':'₦'+v.toLocaleString('en-NG');
const G=gs=>gs.map(g=>`<div class="group"><h3>${g.h}</h3><div class="gn">${g.n||'&nbsp;'}</div>${g.i.map(([n,p,d])=>`<div class="row"><span class="n">${n}${d?`<small>${d}</small>`:''}</span><span class="p">${f(p)}</span></div>`).join('')}</div>`).join('');
const chips=document.getElementById('chips'),kg=document.getElementById('kgroups');
function k(x){[...chips.children].forEach((b,j)=>b.classList.toggle('on',j===x));kg.innerHTML=G(K[x].g)}
K.forEach((c,x)=>{const b=document.createElement('button');b.textContent=c.t;b.onclick=()=>k(x);chips.appendChild(b)});k(0);
document.getElementById('dgroups').innerHTML=G(D);
function tab(){const h=(location.hash||'#kitchen').slice(1);const v=['kitchen','bakery','drinks'].includes(h)?h:'kitchen';
 document.querySelectorAll('.mtabs a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+v));
 document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('on',p.id==='p-'+v));}
addEventListener('hashchange',()=>{tab();scrollTo(0,0)});tab();
document.querySelectorAll('.mtabs a').forEach(a=>a.onclick=e=>{e.preventDefault();history.replaceState(null,'',a.getAttribute('href'));tab()});
