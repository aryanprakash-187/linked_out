// Hand-written LinkedIn-style posts with topic/tone tags. Multi-label.
// Tags: ai, bio, crypto, newjob, student, humblebrag, bait, hook, promo, hiring, politics, swe, sales,
// tech, startup, yc, biz, health, life. "tech?" = arguably tech (see gold()).
export const POSTS = [
  // ai
  { t: ['ai'], text: "We just open-sourced our 7B code model. It beats models twice its size on HumanEval thanks to a new data-filtering pipeline. Paper and weights in the comments." },
  { t: ['ai'], text: "Hot take: RAG isn't dead. Long context windows are great, but retrieval still wins on cost and freshness. Here's how we benchmarked both on 10k support tickets." },
  { t: ['ai'], text: "Spent the weekend fine-tuning a vision transformer on satellite imagery to detect illegal deforestation. Precision went from 0.71 to 0.89 with better augmentation." },
  { t: ['ai'], text: "Interesting new paper on mechanistic interpretability: they found individual features in the residual stream that track whether the model is being deceptive. Worth a read." },
  { t: ['ai', 'swe'], text: "PSA for ML engineers: quantize your embedding models to int8 before deploying. We cut latency 3x with less than 1% recall loss on our search index." },
  // bio
  { t: ['bio', 'tech?'], text: "Our single-cell RNA-seq pipeline now runs 4x faster after switching alignment to STARsolo and moving clustering to GPU. Code is on GitHub." },
  { t: ['bio', 'ai', 'tech?'], text: "AlphaFold changed structural biology, but protein language models are quietly doing the same for variant effect prediction. Here's what we learned scoring 2M missense variants." },
  { t: ['bio', 'tech?'], text: "Defended my PhD on metagenomic assembly of gut microbiomes! Grateful to my advisor and the whole computational genomics lab." },
  { t: ['bio', 'tech?'], text: "New preprint: we used CRISPR screens plus Bayesian modeling to map gene regulatory networks in T cells. Happy to share the analysis notebooks." },
  { t: ['bio', 'tech?'], text: "Anyone have recommendations for benchmarking variant callers on long-read data? Comparing DeepVariant and Clair3 on PacBio HiFi right now." },
  // crypto
  { t: ['crypto'], text: "Bitcoin just broke $150k. If you're still on the sidelines, you're going to regret it. The halving cycle never lies. 🚀" },
  { t: ['crypto'], text: "Excited to announce our DeFi protocol's mainnet launch! Stake your tokens for up to 18% APY. Audited by two firms. Link in bio." },
  { t: ['crypto'], text: "Web3 is about ownership. NFTs let creators earn royalties forever. Here's why every brand needs an on-chain strategy in 2026." },
  { t: ['crypto'], text: "Ethereum's latest upgrade cut layer-2 fees by 90%. This is the moment rollups go mainstream." },
  { t: ['crypto', 'hiring'], text: "We're hiring Solidity engineers! Join a fast-growing team building the future of decentralized finance. Remote, token compensation." },
  // newjob
  { t: ['newjob'], text: "I'm thrilled to announce that I've joined Google as a Senior Product Manager! Excited for this next chapter." },
  { t: ['newjob'], text: "Some personal news: after 6 amazing years at Deloitte, I'm starting a new position as Director of Strategy at Salesforce." },
  { t: ['newjob', 'humblebrag'], text: "Humbled and honored to share that I've been promoted to Vice President. Hard work pays off. Never stop believing in yourself." },
  { t: ['newjob', 'tech?'], text: "Starting a new role today as a Software Engineer at Stripe! Thank you to everyone who helped me along the way." },
  { t: ['newjob'], text: "Happy to share I'm starting a new position as Head of Marketing at Notion." },
  // student
  { t: ['student', 'tech?'], text: "So excited to share that I'll be interning at Meta this summer as a Software Engineering Intern! Can't wait to learn and grow." },
  { t: ['student'], text: "Proud to have completed my sophomore year with a 4.0 GPA while leading the robotics club. Grateful for my professors." },
  { t: ['student', 'humblebrag'], text: "Out of 5,000 applicants, I was one of 20 selected for the Goldman Sachs summer analyst program. Dreams do come true." },
  { t: ['student', 'tech?'], text: "Our team won first place at HackMIT this weekend! We built an app that helps students find study groups." },
  { t: ['student'], text: "Just accepted my return offer from Amazon for next year. Huge thanks to my intern manager and mentors." },
  // humblebrag / motivational
  { t: ['humblebrag'], text: "I got rejected from 200 jobs. I was homeless for 3 months. Today I run a company with 50 employees. Never give up on your dreams." },
  { t: ['humblebrag'], text: "My 4-year-old asked me why I work so hard. Here's what I told her, and what it taught me about leadership. 🧵" },
  { t: ['humblebrag'], text: "I wake up at 4am every day. Cold shower, journaling, 10k steps before sunrise. Discipline is the only shortcut. What's your morning routine?" },
  { t: ['humblebrag'], text: "Yesterday a stranger at the airport recognized me from LinkedIn. It reminded me why I share my journey: to inspire just one person." },
  { t: ['humblebrag'], text: "I turned down a $500k offer from a FAANG company. Here's why money isn't everything and passion is." },
  // engagement bait
  { t: ['bait'], text: "Agree? 👇 Hard work beats talent when talent doesn't work hard. Comment YES if you agree." },
  { t: ['bait'], text: "Which one are you? A) Coffee B) Tea. Drop your answer below! Let's see how many people respond." },
  { t: ['bait'], text: "Like this post if you think remote work is here to stay. Repost to help your network." },
  { t: ['bait'], text: "I'll send my 50-page interview prep guide to everyone who comments 'GUIDE' below. Make sure we're connected!" },
  { t: ['bait'], text: "Unpopular opinion: degrees don't matter anymore. Thoughts? 🤔" },
  // promo
  { t: ['promo'], text: "Join my free webinar this Thursday: '5 Steps to Land a Six-Figure Remote Job'. Only 100 spots left, register at the link below." },
  { t: ['promo', 'tech?'], text: "My new course 'Prompt Engineering Mastery' is live! Use code EARLY50 for 50% off this week only." },
  { t: ['promo'], text: "This week's newsletter is out: 3 growth tactics I used to hit 100k followers. Subscribe so you never miss an issue." },
  { t: ['promo', 'ai'], text: "Struggling with AI? My 6-week cohort-based program teaches non-technical founders to build AI agents. Enrollment closes Friday." },
  { t: ['promo'], text: "We're hosting a live masterclass on personal branding with three top LinkedIn creators. Save your seat now." },
  // hiring
  { t: ['hiring', 'tech?'], text: "We're hiring! Looking for a Senior Backend Engineer (Go, Kubernetes) to join our platform team in Berlin. DM me or apply below." },
  { t: ['hiring', 'tech?'], text: "My team at Microsoft has 3 open roles for data scientists. If you're passionate about experimentation, send me your resume." },
  { t: ['hiring', 'bio', 'tech?'], text: "Our genomics startup is hiring a bioinformatics scientist with experience in NGS pipelines. Boston or remote." },
  { t: ['hiring'], text: "Know a great product designer? We're growing the design team. Referrals appreciated!" },
  { t: ['hiring', 'ai'], text: "Hiring ML research engineers to work on post-training for large language models. Competitive pay, strong team, interesting problems." },
  // politics/news
  { t: ['politics'], text: "The new tariffs announced this morning will raise prices for every small business that imports parts. Congress needs to act." },
  { t: ['politics'], text: "Whatever your views on the election, the polarization in this country is hurting our ability to solve real problems." },
  { t: ['politics'], text: "The Supreme Court's ruling on immigration policy today will affect millions of families. Here's what it means." },
  { t: ['politics'], text: "Climate policy is economic policy. The carbon tax debate in Parliament this week shows how far apart the parties are." },
  { t: ['politics'], text: "Regardless of party, voters deserve candidates who talk about housing costs instead of culture wars." },
  // swe
  { t: ['swe'], text: "Stop writing 500-line functions. Here's a refactoring technique that made our codebase easier to test: extract pure functions first, side effects last." },
  { t: ['swe'], text: "We migrated our monolith from Postgres 12 to 16 with zero downtime using logical replication. Writeup on our engineering blog." },
  { t: ['swe'], text: "TypeScript tip: use satisfies instead of type annotations for config objects. You keep the literal types and still get checking." },
  { t: ['swe'], text: "Our p99 latency dropped from 800ms to 120ms after we found an N+1 query hiding in the ORM. Always check your query logs." },
  { t: ['swe'], text: "Rust in production after one year: fewer outages, slower onboarding, and a compile time problem we're still fighting." },
  // clickbait hooks
  { t: ['hook'], text: "I was fired on a Tuesday. What my boss said next shocked me. 👇 (read till the end)" },
  { t: ['hook', 'tech?'], text: "Stop using ChatGPT like this. 97% of people are making this mistake and don't even know it." },
  { t: ['hook'], text: "Nobody talks about this, but it's the real reason you're not getting promoted. Thread 🧵" },
  { t: ['hook', 'tech?'], text: "This one Excel trick saved me 10 hours a week. I can't believe I didn't know it sooner." },
  { t: ['hook', 'tech?'], text: "Google just did something that will change the job market forever. Here's what you need to know." },
  // sales/marketing
  { t: ['sales'], text: "Cold email tip: your subject line should be 3 words or fewer. Our open rate went from 22% to 41%." },
  { t: ['sales'], text: "The best salespeople I know ask more questions than they answer. Discovery is everything." },
  { t: ['sales'], text: "B2B marketers: stop gating your whitepapers. We ungated ours and pipeline grew 30%." },
  { t: ['sales'], text: "Closed our biggest deal ever today after an 11-month sales cycle. Persistence and genuine relationships win." },
  { t: ['sales'], text: "Your ICP is probably too broad. Here's the framework we used to narrow ours to 400 accounts." },
  // tech, startups (a feed that is mostly tech, like most LinkedIn feeds)
  { t: ['startup', 'tech', 'yc', 'ai?'], text: "Kairos Health (YC F26) automates patient engagement for dentists. Front desks are too busy to call patients about overdue cleanings and expiring insurance, so Kairos plugs into the practice's software, uses voice AI to talk to patients and books them into the schedule. Already live with dozens of dental groups. Book a demo on our site. Congrats on the launch!" },
  { t: ['startup', 'tech'], text: "We're live on Product Hunt today! Ledgerly reconciles your company's bank transactions automatically, so finance teams close the books in hours instead of weeks. Would love your feedback." },
  { t: ['startup', 'tech'], text: "We raised a $12M Series A to build the operating system for independent pharmacies. Our software handles inventory, insurance claims and refills in one place." },
  { t: ['tech', 'ai?'], text: "Apple's new chips are a big deal for on-device inference: twice the neural engine throughput at the same power. Laptops are becoming serious ML machines." },
  { t: ['tech'], text: "A misconfigured S3 bucket exposed 3 million customer records last week. Here's the cloud security checklist our team runs every quarter." },
  { t: ['tech', 'swe'], text: "We moved our data warehouse from Snowflake to DuckDB and Parquet files on S3 and cut our analytics bill by 70%. Queries got faster too." },
  { t: ['tech', 'ai?'], text: "Our robotics team just shipped a warehouse picking arm that handles 1,200 items an hour with a 99.7% success rate. Huge milestone for the hardware team." },
  { t: ['tech'], text: "Quantum computing update: the new 1,000-qubit processors still can't beat classical simulation on useful problems, but error rates are dropping fast." },
  { t: ['startup', 'tech', 'yc', 'ai'], text: "Fieldnote (YC W26) uses speech recognition and a language model to turn doctor-patient conversations into clinical notes in real time. Now live in 40 clinics." },
  { t: ['ai', 'politics', 'tech'], text: "EU AI Act enforcement starts next month. If your product uses facial recognition or scores job applicants, here's what changes for you." },
  // everyday LinkedIn that isn't tech
  { t: ['biz'], text: "Our bakery just celebrated 10 years on Main Street. Thank you to every regular who came in for a croissant and a chat." },
  { t: ['biz'], text: "Mortgage rates fell to 5.8% this week, and first-time buyers are finally coming back to the housing market." },
  { t: ['life', 'humblebrag?'], text: "Leadership lesson from 20 years of managing teams: praise in public, give feedback in private, and always explain the why." },
  { t: ['health'], text: "Nurses at our hospital worked 14-hour shifts all through flu season. They deserve better staffing, not pizza parties." },
  { t: ['life', 'humblebrag?'], text: "Ran my first marathon at 45 this weekend. 4 hours 12 minutes. Training taught me more about patience than any job." },
  { t: ['life'], text: "Our food bank served 50,000 meals this winter thanks to 300 volunteers. If you can give an hour a week, we need you." },
  { t: ['biz'], text: "Q3 results: revenue up 14% and operating margin at 22%. Proud of how our retail stores executed in a tough consumer market." },
  { t: ['life'], text: "Thank you to everyone who came to our team offsite in Lisbon. Great food, great people and a lot of whiteboard sessions." },
];

// Scenarios: the user's instructions, the topics a parser would extract, and
// which tags count as "hide" (block mode) or "keep" (only mode).
export const SCENARIOS = [
  { id: 'no-crypto', instr: 'Hide crypto and web3 posts.', mode: 'block', topics: ['crypto and web3'], tags: ['crypto'], kind: 'topic' },
  { id: 'only-ai', instr: 'Only show me posts about AI and machine learning.', mode: 'only', topics: ['AI and machine learning'], tags: ['ai'], kind: 'topic' },
  { id: 'only-bio', instr: 'Only show posts about bioinformatics and computational biology.', mode: 'only', topics: ['bioinformatics', 'computational biology'], tags: ['bio'], kind: 'topic' },
  { id: 'no-politics', instr: 'No politics.', mode: 'block', topics: ['politics'], tags: ['politics'], kind: 'topic' },
  { id: 'no-hiring', instr: 'Hide hiring posts and job openings.', mode: 'block', topics: ['hiring posts', 'job openings'], tags: ['hiring'], kind: 'topic' },
  { id: 'no-newjob', instr: 'No job announcements or new role posts.', mode: 'block', topics: ['job announcements', 'new role posts'], tags: ['newjob'], kind: 'genre' },
  { id: 'no-promo', instr: 'Hide posts promoting courses, webinars or newsletters.', mode: 'block', topics: ['promoting courses', 'webinars', 'newsletters'], tags: ['promo'], kind: 'genre' },
  { id: 'no-students', instr: 'Hide internship and student achievement posts.', mode: 'block', topics: ['internship', 'student achievement'], tags: ['student'], kind: 'genre' },
  { id: 'no-humblebrag', instr: 'No motivational stories or humblebrags.', mode: 'block', topics: ['motivational stories', 'humblebrags'], tags: ['humblebrag'], kind: 'tone' },
  { id: 'no-clickbait', instr: 'No clickbait.', mode: 'block', topics: ['clickbait'], tags: ['hook', 'bait'], kind: 'tone' },
  { id: 'no-bait', instr: 'Hide engagement bait.', mode: 'block', topics: ['engagement bait'], tags: ['bait'], kind: 'tone' },
  // Broad subjects most of a LinkedIn feed is about. A single word like
  // "technology" embeds poorly, and these feeds are mostly on-topic.
  { id: 'only-tech', instr: 'Only show me posts about technology.', mode: 'only', topics: ['technology'], tags: ['ai', 'swe', 'crypto', 'tech'], kind: 'broad' },
  { id: 'only-startups', instr: 'Only show me startup posts.', mode: 'only', topics: ['startup'], tags: ['startup'], kind: 'broad' },
];

// gold: true = should be hidden, null = either answer is fine. A tag ending
// in "?" ("tech?") marks a post that's arguably about that subject.
export function gold(scn, post) {
  const has = post.t.some((t) => scn.tags.includes(t));
  if (!has && post.t.some((t) => t.endsWith('?') && scn.tags.includes(t.slice(0, -1)))) return null;
  return scn.mode === 'block' ? has : !has;
}
