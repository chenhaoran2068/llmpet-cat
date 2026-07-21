'use strict';

const blocks = Math.max(1, Number(new URLSearchParams(location.search).get('blocks')) || 1);
if (blocks > 1) document.querySelector('h1').textContent = `已经认真工作 ${blocks * 40} 分钟啦！`;
