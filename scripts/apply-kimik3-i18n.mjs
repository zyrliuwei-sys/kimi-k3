// One-shot i18n merge for kimik3 ai landing copy. Safe to re-run (idempotent).
import { readFileSync, writeFileSync } from 'node:fs';

const en = {
  'landing.nav.faq': 'FAQ',

  'landing.hero.eyebrow': 'Powered by the Kimi K3 model',
  'landing.hero.headline_prefix': 'Think bigger with',
  'landing.hero.headline_gradient': 'Kimi K3 AI.',
  'landing.hero.subheadline':
    'The all-in-one AI workspace for chat, research, and content. Ask anything, draft anything, and turn one conversation into a hundred ready-to-ship outcomes.',
  'landing.hero.cta': 'Try Kimi K3 AI — free',
  'landing.hero.secondary': 'See how it works',
  'landing.hero.proof': 'Trusted by 100,000+ thinkers, builders, and teams',
  'landing.hero.chat_user':
    'Draft a launch plan for our AI note app — keep it under one page.',
  'landing.hero.chat_assistant':
    "Here's a tight one-pager: positioning, the 3 channels to test first, a 2-week prelaunch checklist, and the metrics that actually signal traction. Want me to expand any section?",
  'landing.hero.tag_1': 'Launch plan',
  'landing.hero.tag_2': '1-pager',
  'landing.hero.tag_3': '2-week plan',
  'landing.hero.chat_placeholder': 'Ask Kimi anything…',

  'landing.logos.title': 'Trusted by fast-moving teams at',
  'landing.logos.brands': 'Northwind|Lumen|Quanta|Vertex|Helio|Orbit|Meridian',

  'landing.assets.title_prefix': 'One conversation.',
  'landing.assets.title_gradient': 'A hundred outcomes.',
  'landing.assets.description':
    'Every chat can become far more than an answer — Kimi K3 AI turns a single prompt into drafts, plans, code, and assets you can actually use.',
  'landing.assets.items':
    'Instant answers|Long-form articles|Email drafts|Social posts|Code snippets|Research briefs|Meeting summaries|Translations|Outlines & plans|Tables & data|Brainstorm lists|Product specs|Headlines & hooks|Follow-up emails|Slide talking points|Release notes',

  'landing.start.title': 'Start with a single message',
  'landing.start.description':
    'No setup, no prompt engineering. Type what you need — Kimi gets to work before you finish your coffee.',
  'landing.start.placeholder': 'Summarize this PDF and draft a team update…',
  'landing.start.button': 'Send',
  'landing.start.examples':
    'Summarize a document|Draft an email|Brainstorm names|Debug my code|Plan a project',

  'landing.builtfor.title': 'Built for teams that think bigger',
  'landing.builtfor.description':
    'From early-stage founders to research labs, Kimi K3 AI is the shared brain your team reaches for first.',
  'landing.builtfor.cards':
    'Founders & product teams|||Validate ideas, draft specs, and ship faster with an AI partner in every decision.##Researchers & analysts|||Summarize sources, synthesize findings, and turn raw notes into shareable briefs.##Writers & content teams|||Go from blank page to polished draft in minutes — in your team’s voice.##Developers & engineers|||Explain, refactor, and scaffold code, then document it without breaking flow.',
  'landing.builtfor.quote':
    'We replaced four tools with Kimi K3 AI. Our team drafts, researches, and ships from one place — it feels like we hired three more people.',
  'landing.builtfor.quote_author': 'Dana R. — Head of Product, Northwind Labs',

  'landing.stats.title': 'Modern teams run on Kimi K3 AI',
  'landing.stats.subtitle':
    'From scrappy startups to global research groups — less busywork, more breakthroughs.',
  'landing.stats.items':
    '10M+|||messages a month##3×|||faster first draft##100K+|||active teams##4.9/5|||average rating',

  'landing.vfeatures.title': 'AI that adapts to how you work',
  'landing.vfeatures.description':
    "Kimi K3 AI isn't a single chat box — it's a workspace that bends to your team's workflow.",
  'landing.vfeatures.items':
    'Workspaces that match how you think|||Organize chats, projects, and prompts into shared workspaces with the right context for every team.##Build a whole project from one prompt|||Turn a single message into a full draft, outline, or plan — then refine it conversation by conversation.##Memory & knowledge that follow you|||Upload files and let Kimi search them by meaning, not keywords — your library becomes an instant answer engine.##Built for teams to think together|||Comments, roles, and shared spaces keep everyone aligned, from first idea to final review.',
  'landing.vfeatures.mock_workspaces': 'Growth|Product|Research|Personal',
  'landing.vfeatures.mock_prompt': 'Turn this meeting into a project plan',
  'landing.vfeatures.mock_chip_1': 'Goals',
  'landing.vfeatures.mock_chip_2': 'Owners',
  'landing.vfeatures.mock_chip_3': 'Deadlines',
  'landing.vfeatures.mock_search': 'first customer who upgraded',
  'landing.vfeatures.mock_search_note':
    '3 results across 2 files — matched by meaning.',
  'landing.vfeatures.mock_file_1': 'Q3-onboarding-notes.pdf',
  'landing.vfeatures.mock_file_2': 'founder-interviews.md',
  'landing.vfeatures.mock_file_3': 'pricing-teardown.docx',
  'landing.vfeatures.mock_comment_1': 'Can we tighten the intro?',
  'landing.vfeatures.mock_comment_2': 'Done — much sharper now.',

  'landing.footer.tagline':
    'The AI workspace for thinking, building, and shipping — all in one place.',
  'landing.footer.col_product': 'Product',
  'landing.footer.col_company': 'Company',
  'landing.footer.col_resources': 'Resources',
  'landing.footer.product_features': 'Features',
  'landing.footer.product_pricing': 'Pricing',
  'landing.footer.product_teams': 'For teams',
  'landing.footer.product_apikeys': 'API keys',
  'landing.footer.company_blog': 'Blog',
  'landing.footer.company_contact': 'Contact',
  'landing.footer.company_privacy': 'Privacy',
  'landing.footer.company_terms': 'Terms',
  'landing.footer.resources_docs': 'Docs',
  'landing.footer.resources_changelog': 'Changelog',
  'landing.footer.resources_status': 'Status',
  'landing.footer.resources_signin': 'Sign in',
  'landing.footer.newsletter_title': 'Ship faster with Kimi',
  'landing.footer.newsletter_desc':
    'Product updates and AI workflow tips. No spam, unsubscribe anytime.',
  'landing.footer.newsletter_placeholder': 'you@company.com',
  'landing.footer.newsletter_button': 'Subscribe',
  'landing.footer.rights': 'All rights reserved.',

  // Updated existing keys
  'landing.pricing.title': 'Simple, scalable pricing',
  'landing.pricing.description':
    'Start free. Upgrade when your team is ready to move faster.',
  'landing.pricing.starter': 'Free',
  'landing.pricing.starter_desc': 'For curious minds getting started.',
  'landing.pricing.pro': 'Pro',
  'landing.pricing.pro_desc': 'For makers shipping every day.',
  'landing.pricing.enterprise': 'Enterprise',
  'landing.pricing.enterprise_desc': 'For teams that need scale and control.',

  'landing.faq.title': 'Frequently asked questions',
  'landing.faq.description': 'Everything you need to know about Kimi K3 AI.',
  'landing.faq.stack.question': 'Which AI model does Kimi K3 AI use?',
  'landing.faq.stack.answer':
    'Kimi K3 AI runs on the Kimi K3 model — a frontier model built for long-context reasoning, writing, and research. We continuously evaluate and add the best models available.',
  'landing.faq.payment.question': 'How does pricing work?',
  'landing.faq.payment.answer':
    'Start free. Paid plans are billed monthly or yearly and unlock more credits and team features. Enterprise plans are customizable.',
  'landing.faq.database.question': 'Is my data private and secure?',
  'landing.faq.database.answer':
    'Yes. Your conversations and files are encrypted at rest, we never train on your private content, and you can delete your data anytime.',
  'landing.faq.customize.question': 'Can my team use it together?',
  'landing.faq.customize.answer':
    'Absolutely. Workspaces, roles, and shared spaces let your team collaborate from first idea to final review.',
  'landing.faq.license.question': 'Can I cancel anytime?',
  'landing.faq.license.answer':
    'Yes — cancel anytime, no long-term commitment. You keep access until the end of your billing period.',

  'landing.cta.headline': 'Start thinking with Kimi K3 AI today',
  'landing.cta.subheadline':
    'Join 100,000+ people using Kimi to chat, research, and create. Free to start — no credit card required.',
  'landing.cta.button': 'Try Kimi K3 AI — free',
};

const zh = {
  'landing.nav.faq': '常见问题',

  'landing.hero.eyebrow': '由 Kimi K3 模型驱动',
  'landing.hero.headline_prefix': '让思考更进一步 ——',
  'landing.hero.headline_gradient': 'Kimi K3 AI',
  'landing.hero.subheadline':
    '一站式 AI 工作台,集对话、研究与内容创作于一体。问任何问题、写任何内容,把一次对话变成上百个可直接交付的成果。',
  'landing.hero.cta': '免费体验 Kimi K3 AI',
  'landing.hero.secondary': '看看它能做什么',
  'landing.hero.proof': '已获 100,000+ 思考者、创造者与团队的信赖',
  'landing.hero.chat_user': '帮我们的 AI 笔记 App 写一份发布计划,一页以内。',
  'landing.hero.chat_assistant':
    '这是一份精简的一页纸:定位、首批测试的 3 个渠道、两周预热清单,以及真正能说明势头的指标。需要我展开任意一节吗?',
  'landing.hero.tag_1': '发布计划',
  'landing.hero.tag_2': '一页纸',
  'landing.hero.tag_3': '两周排期',
  'landing.hero.chat_placeholder': '向 Kimi 提问……',

  'landing.logos.title': '深受高效团队的信赖',
  'landing.logos.brands': 'Northwind|Lumen|Quanta|Vertex|Helio|Orbit|Meridian',

  'landing.assets.title_prefix': '一次对话,',
  'landing.assets.title_gradient': '上百种成果。',
  'landing.assets.description':
    '每一次对话都不只是答案 —— Kimi K3 AI 把一个提示词变成可直接使用的草稿、方案、代码与素材。',
  'landing.assets.items':
    '即时回答|长文写作|邮件草稿|社媒文案|代码片段|研究简报|会议纪要|多语翻译|大纲与计划|表格与数据|头脑风暴|产品文档|标题与钩子|跟进邮件|演讲要点|发布说明',

  'landing.start.title': '从一条消息开始',
  'landing.start.description':
    '无需配置,无需提示词工程。输入你的需求 —— Kimi 在你喝完咖啡前就开始工作。',
  'landing.start.placeholder': '总结这份 PDF,并起草一份团队周报……',
  'landing.start.button': '发送',
  'landing.start.examples': '总结文档|起草邮件|头脑风暴|调试代码|规划项目',

  'landing.builtfor.title': '为思考更进一步的团队而生',
  'landing.builtfor.description':
    '从早期创业者到研究实验室,Kimi K3 AI 是你的团队最先想到的那个「共享大脑」。',
  'landing.builtfor.cards':
    '创业者与产品团队|||验证想法、撰写文档,让每一次决策都有 AI 伙伴同行,更快交付。##研究员与分析师|||总结资料、整合发现,把零散笔记变成可分享的简报。##写作与内容团队|||从空白页到精修稿,只需数分钟 —— 用你们团队的语气。##开发者与工程师|||解释、重构、生成代码,再顺手写好文档,不打断节奏。',
  'landing.builtfor.quote':
    '我们用 Kimi K3 AI 取代了四个工具。整个团队在同一个地方起草、调研、交付 —— 就像多招了三个人。',
  'landing.builtfor.quote_author': 'Dana R. —— Northwind Labs 产品负责人',

  'landing.stats.title': '现代团队都在用 Kimi K3 AI',
  'landing.stats.subtitle':
    '从敏捷创业团队到全球研究机构 —— 更少琐事,更多突破。',
  'landing.stats.items':
    '1000万+|||每月消息量##3×|||更快完成初稿##10万+|||活跃团队##4.9/5|||平均评分',

  'landing.vfeatures.title': '适配你工作方式的 AI',
  'landing.vfeatures.description':
    'Kimi K3 AI 不是一个聊天框 —— 它是一个能贴合你团队流程的工作台。',
  'landing.vfeatures.items':
    '贴合你思维的工作区|||把对话、项目与提示词整理进共享工作区,为每个团队保留恰到好处的上下文。##从一个提示词构建整个项目|||把一条消息变成完整的草稿、大纲或方案,再通过对话逐步打磨。##跟随你的记忆与知识库|||上传文件,让 Kimi 按语义而非关键词检索 —— 你的资料库就是一台即时问答引擎。##为团队协作而生|||评论、角色与共享空间,让所有人从第一个想法到最终评审保持一致。',
  'landing.vfeatures.mock_workspaces': '增长|产品|研究|个人',
  'landing.vfeatures.mock_prompt': '把这次会议变成项目计划',
  'landing.vfeatures.mock_chip_1': '目标',
  'landing.vfeatures.mock_chip_2': '负责人',
  'landing.vfeatures.mock_chip_3': '截止日期',
  'landing.vfeatures.mock_search': '第一个升级的客户',
  'landing.vfeatures.mock_search_note':
    '在 2 个文件中找到 3 条结果 —— 按语义匹配。',
  'landing.vfeatures.mock_file_1': 'Q3-新用户笔记.pdf',
  'landing.vfeatures.mock_file_2': '创始人访谈.md',
  'landing.vfeatures.mock_file_3': '定价拆解.docx',
  'landing.vfeatures.mock_comment_1': '开头能不能再精炼一点?',
  'landing.vfeatures.mock_comment_2': '已改 —— 利落多了。',

  'landing.footer.tagline': '集思考、构建与交付于一体的 AI 工作台。',
  'landing.footer.col_product': '产品',
  'landing.footer.col_company': '公司',
  'landing.footer.col_resources': '资源',
  'landing.footer.product_features': '功能',
  'landing.footer.product_pricing': '价格',
  'landing.footer.product_teams': '团队版',
  'landing.footer.product_apikeys': 'API 密钥',
  'landing.footer.company_blog': '博客',
  'landing.footer.company_contact': '联系我们',
  'landing.footer.company_privacy': '隐私政策',
  'landing.footer.company_terms': '服务条款',
  'landing.footer.resources_docs': '文档',
  'landing.footer.resources_changelog': '更新日志',
  'landing.footer.resources_status': '运行状态',
  'landing.footer.resources_signin': '登录',
  'landing.footer.newsletter_title': '用 Kimi 更快交付',
  'landing.footer.newsletter_desc':
    '产品更新与 AI 工作流技巧。绝无垃圾邮件,随时退订。',
  'landing.footer.newsletter_placeholder': 'you@company.com',
  'landing.footer.newsletter_button': '订阅',
  'landing.footer.rights': '保留所有权利。',

  'landing.pricing.title': '简单、可扩展的价格',
  'landing.pricing.description': '免费开始。等团队准备提速时再升级。',
  'landing.pricing.starter': '免费版',
  'landing.pricing.starter_desc': '给刚上手的探索者。',
  'landing.pricing.pro': '专业版',
  'landing.pricing.pro_desc': '给每天都在交付的创造者。',
  'landing.pricing.enterprise': '企业版',
  'landing.pricing.enterprise_desc': '给需要规模与掌控的团队。',

  'landing.faq.title': '常见问题',
  'landing.faq.description': '关于 Kimi K3 AI,你想知道的都在这里。',
  'landing.faq.stack.question': 'Kimi K3 AI 用的是哪个 AI 模型?',
  'landing.faq.stack.answer':
    'Kimi K3 AI 运行在 Kimi K3 模型之上 —— 一款专为长上下文推理、写作与研究打造的前沿模型。我们会持续评估并接入最优秀的模型。',
  'landing.faq.payment.question': '价格是怎么算的?',
  'landing.faq.payment.answer':
    '免费版即可上手。付费方案按月或按年订阅,提供更多额度与团队功能;企业版可定制。',
  'landing.faq.database.question': '我的数据安全吗?',
  'landing.faq.database.answer':
    '安全。你的对话与文件经过加密存储,我们绝不会用你的私密内容训练模型,你也可随时删除数据。',
  'landing.faq.customize.question': '我的团队能一起用吗?',
  'landing.faq.customize.answer':
    '可以。工作区、角色权限与共享空间,让团队从第一个想法到最终评审全程协作。',
  'landing.faq.license.question': '可以随时取消吗?',
  'landing.faq.license.answer':
    '可以,随时取消,无需长期承诺;取消后你仍可使用至当前计费周期结束。',

  'landing.cta.headline': '今天就开始,与 Kimi K3 AI 一起思考',
  'landing.cta.subheadline':
    '加入 100,000+ 正在使用 Kimi 聊天、调研与创作的人。免费开始 —— 无需信用卡。',
  'landing.cta.button': '免费体验 Kimi K3 AI',
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
