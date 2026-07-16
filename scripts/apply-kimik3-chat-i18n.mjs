import { readFileSync, writeFileSync } from 'node:fs';

const en = {
  'settings.nav.chat': 'Chat',
  'settings.chat.new_chat': 'New chat',
  'settings.chat.no_chats': 'No conversations yet',
  'settings.chat.untitled': 'New chat',
  'settings.chat.placeholder': 'Message Kimi K3 AI…',
  'settings.chat.send': 'Send',
  'settings.chat.disclaimer':
    'Kimi K3 AI can make mistakes. Check important info.',
  'settings.chat.you_initial': 'You',
  'settings.chat.welcome_title': 'How can I help today?',
  'settings.chat.welcome_desc':
    'Ask anything, draft anything, or pick a starting point below.',
  'settings.chat.examples':
    'Summarize a document|Draft a cold outreach email|Explain a concept simply|Brainstorm product names',
  'settings.chat.delete': 'Delete chat',
};

const zh = {
  'settings.nav.chat': '聊天',
  'settings.chat.new_chat': '新对话',
  'settings.chat.no_chats': '还没有对话',
  'settings.chat.untitled': '新对话',
  'settings.chat.placeholder': '给 Kimi K3 AI 发消息……',
  'settings.chat.send': '发送',
  'settings.chat.disclaimer': 'Kimi K3 AI 可能出错,请核实重要信息。',
  'settings.chat.you_initial': '你',
  'settings.chat.welcome_title': '今天我能帮你什么?',
  'settings.chat.welcome_desc': '随便问、随便写,或从下方挑一个开始。',
  'settings.chat.examples':
    '总结一份文档|写一封陌生开发邮件|用简单的话解释一个概念|头脑风暴产品名字',
  'settings.chat.delete': '删除对话',
};

function merge(file, patch) {
  const path = new URL(file, import.meta.url);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  let added = 0;
  let updated = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (json[k] === undefined) added++;
    else updated++;
    json[k] = v;
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${file}: +${added} new, ~${updated} updated`);
}

merge('../messages/en.json', en);
merge('../messages/zh.json', zh);
