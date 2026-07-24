'use strict';

const result = document.getElementById('result');
const choices = document.getElementById('choices');
const findGame = document.getElementById('find-game');
const catSpot = document.getElementById('cat-spot');
const blocks = Math.max(1, Number(new URLSearchParams(location.search).get('blocks')) || 1);
if (blocks > 1) document.querySelector('h1').textContent = `连续工作 ${blocks * 40} 分钟了哦`;

function tellPet(action) {
  if (window.pet && window.pet.breakAction) window.pet.breakAction(action);
}

function disableChoices() {
  choices.querySelectorAll('button:not([data-action="close"])').forEach((button) => { button.disabled = true; });
}

function beginBreathing() {
  disableChoices();
  let remaining = 30;
  result.textContent = `吸气……呼气……还有 ${remaining} 秒`;
  const timer = setInterval(() => {
    remaining -= 1;
    result.textContent = remaining ? `吸气……呼气……还有 ${remaining} 秒` : '呼吸完成！你的肩膀可以放松一点了。';
    if (!remaining) { clearInterval(timer); tellPet('breathe'); }
  }, 1000);
}

function beginFindCat() {
  disableChoices();
  findGame.classList.remove('hidden');
  const left = 8 + Math.floor(Math.random() * 76);
  catSpot.style.left = `${left}%`;
  catSpot.style.top = `${Math.floor(Math.random() * 8)}px`;
  result.textContent = '喵～猫猫藏起来了，点一下那只小猫。';
}

choices.addEventListener('click', (event) => {
  const action = event.target.dataset.action;
  if (action === 'water') { disableChoices(); tellPet('water'); result.textContent = '喝水打卡成功！猫猫为你鼓爪。'; }
  if (action === 'breathe') beginBreathing();
  if (action === 'find') beginFindCat();
  if (action === 'close') tellPet('close');
});
catSpot.addEventListener('click', () => { tellPet('find'); findGame.classList.add('hidden'); result.textContent = '找到了！休息也是一种小胜利。'; });
