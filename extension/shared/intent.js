// Turns the user's free-text instructions into topics the on-device model can
// compare posts against. Deterministic, so it's unit-testable and the options
// page can show "here's how out understood you".
//
//   "Only show me AI posts. No humblebrags or engagement bait."
//   -> { only: true,
//        show: [{ label: 'AI', anchors: [...] }],
//        hide: [{ label: 'humblebrags or engagement bait', anchors: [...] }] }
//
// Known LinkedIn genres (bait, humblebrags, course promos, ...) get extra
// example phrases as anchors. In our eval this lifted tone filters from
// AUC ~0.70 to ~0.90, because a bare phrase like "humblebrag" embeds poorly.
(function (root) {
  const control = (root.control = root.control || {});

  const GENRES = [
    {
      id: 'bait',
      trigger: /engagement|bait|agree\?|comment (?:yes|below)|polls?\b/i,
      anchors: [
        'Comment YES if you agree',
        'Like and repost this to help your network',
        'Drop your answer in the comments below',
        'Comment a keyword to get my free guide',
      ],
    },
    {
      // Sensational hooks that withhold the point to make you click "see more".
      // ("clickbait" also matches the bait genre above, so it gets both sets.)
      id: 'clickbait',
      trigger: /click ?bait|hooks?\b|sensational|curiosity|rage ?bait/i,
      anchors: [
        "You won't believe what happened next",
        'This one simple trick changed everything',
        'Nobody is talking about this, and it will change your career',
        'I was shocked when I found out the truth',
        'Stop doing this immediately. Here is why',
        '99% of people get this wrong',
      ],
    },
    {
      id: 'humblebrag',
      trigger: /humble ?brag|motivational|inspirational|inspiring|rags to riches|life lessons?|hustle|guru|cringe|broetry|bragg/i,
      anchors: [
        'An inspirational rags-to-riches story about never giving up',
        'A personal anecdote that teaches a life lesson about success and leadership',
        'Bragging about my discipline, achievements and success while pretending to be humble',
      ],
    },
    {
      id: 'promo',
      trigger: /courses?|webinars?|newsletters?|masterclass|self[- ]?promo|promoting|selling|cohorts?|ebooks?/i,
      anchors: [
        'Register for my free webinar, limited seats',
        'Enroll in my online course with a discount code',
        'Subscribe to my newsletter',
      ],
    },
    {
      id: 'newjob',
      trigger: /new (?:job|role|position)s?|job (?:change|announcement|update)s?|career (?:update|announcement)s?|promotions? announce|work anniversar/i,
      anchors: [
        "Excited to share that I'm starting a new position",
        'I have accepted a new role and joined a new company',
        'Some personal news: I was promoted',
      ],
    },
    {
      id: 'student',
      trigger: /intern(?:ship)?s?\b|students?|graduat|college|universit|gpa/i,
      anchors: [
        "I'm excited to be interning this summer",
        'Proud of my grades and my university achievements',
        'Our student team won the hackathon',
      ],
    },
    {
      id: 'hiring',
      trigger: /hiring|job (?:openings?|posts?|postings?|ads?|offers?)|recruit|open roles?|vacanc/i,
      anchors: ["We're hiring, apply now or send me your resume", 'Open job positions on my team'],
    },
  ];

  // Broad subjects most LinkedIn posts fall under. A topic that names one gets
  // its examples as extra anchors: on its own, "technology" embeds as vaguely
  // corporate, and a post about voice AI for dentists didn't look like it.
  // The subjects a topic doesn't name, plus the genres above, are what
  // "Only show me X" compares a post against (see local-filter.js). `covers`
  // lists narrower subjects that are part of this one, so they aren't
  // treated as competition (AI posts are technology posts).
  const SUBJECTS = [
    {
      id: 'tech',
      trigger: /\btech\b|technolog|gadgets?|computing|digital/i,
      covers: ['ai', 'software', 'crypto', 'startup'],
      anchors: [
        'A new software product, app or platform launch',
        'A startup building software that uses AI to automate work for an industry',
        'Healthtech, fintech and edtech: software for doctors, banks and schools',
        'Engineers writing code and building cloud infrastructure, databases and APIs',
        'Artificial intelligence and machine learning models',
        'Hardware, chips, robotics and devices',
        'Cybersecurity, data breaches and privacy',
        'Crypto, blockchain and web3',
      ],
    },
    {
      id: 'ai',
      trigger: /\bai\b|artificial intelligence|machine learning|\bml\b|\bllms?\b|gen ?ai|deep learning/i,
      anchors: ['Artificial intelligence and machine learning models', 'Training and deploying large language models'],
    },
    {
      id: 'software',
      trigger: /software|programming|coding|\bcode\b|developers?\b|devops/i,
      anchors: [
        'Writing code: refactoring, testing and debugging',
        'Our engineering team migrated databases and cut latency',
        'Programming languages and developer tools',
      ],
    },
    {
      id: 'crypto',
      trigger: /crypto|bitcoin|blockchain|web ?3|defi\b|nfts?\b/i,
      anchors: ['Crypto, blockchain, tokens and web3'],
    },
    {
      id: 'startup',
      trigger: /start-?ups?|founders?|entrepreneur|venture|y ?combinator|\byc\b|fundrais/i,
      anchors: [
        'Founders announce the launch of their new startup',
        'Our startup raised a seed round from investors',
        'A company backed by Y Combinator',
      ],
    },
    {
      id: 'science',
      trigger: /scien|research|biolog|genom|physics|chemistry/i,
      anchors: ['Scientific research, papers and lab results'],
    },
    {
      id: 'business',
      trigger: /business|financ|econom|markets?\b|invest|real estate|housing/i,
      anchors: ['Interest rates, inflation and the economy', 'Company earnings, revenue and growth', 'The housing market and real estate'],
    },
    {
      id: 'politics',
      trigger: /politic|elections?|government|policy|policies/i,
      anchors: ['Politics, elections and government policy'],
    },
    {
      id: 'sales',
      trigger: /sales|marketing|branding/i,
      anchors: ['Sales and marketing tips to grow revenue'],
    },
    {
      id: 'leadership',
      trigger: /leadership|management|managers?\b|workplace|productivity/i,
      anchors: ['Leadership advice about managing teams and workplace culture'],
    },
    {
      id: 'health',
      trigger: /health|medic|hospital|nurs|doctor|fitness|wellness/i,
      anchors: ['Hospitals, nurses, doctors and patient care', 'Running, fitness and wellbeing'],
    },
    {
      id: 'life',
      trigger: /personal|family|life\b|volunteer|community|small business/i,
      anchors: ['A personal update about family and life outside work', 'We volunteered at a community event this weekend'],
    },
  ];

  // Order matters only for readability; matching uses the earliest hit.
  const NEG_RE =
    /\b(?:hide|no|not|don'?t|do not|never|without|less|stop|remove|block|filter out|skip|avoid|tired of|hate|exclude|get rid of)\b/i;
  const ONLY_RE = /\b(?:only|just|exclusively|nothing but)\b/i;
  const MORE_RE = /\b(?:show|more|want|interested|love|like|see|prefer|give me)\b/i;

  // Words stripped from the start/end of a clause to leave the topic.
  const LEAD = new Set(
    (
      "please i i'd id would like only just exclusively nothing but show me hide no more any all the posts post " +
      'content stuff things about on regarding related to from of that are which is with want see dont don’t ' +
      "don't do not never less block remove skip avoid exclude filter out get rid stop showing anything " +
      'everything else interested in tired hate prefer give my feed'
    ).split(/\s+/),
  );
  const TRAIL = new Set('posts post content stuff please anymore things in on my feed linkedin'.split(/\s+/));

  function cleanTopic(clause) {
    const words = clause
      .replace(/[“”"]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    while (words.length && LEAD.has(words[0].toLowerCase())) words.shift();
    while (words.length && TRAIL.has(words[words.length - 1].toLowerCase())) words.pop();
    return words.join(' ').replace(/^[,:\-–—\s]+|[,:\-–—\s]+$/g, '');
  }

  function firstIndex(re, text) {
    const m = re.exec(text);
    return m ? m.index : Infinity;
  }

  function makeTopic(label) {
    const parts = label
      .split(/,|\band\b|\bor\b|&|\//i)
      .map((s) => cleanTopic(s))
      .filter((s) => s && s.toLowerCase() !== label.toLowerCase());
    const anchors = [label, ...parts];
    const genres = [];
    const all = [...GENRES, ...SUBJECTS];
    for (const g of all) {
      if (!g.trigger.test(label)) continue;
      for (const id of [g.id, ...(g.covers || [])]) {
        if (genres.includes(id)) continue;
        genres.push(id);
        anchors.push(...all.find((x) => x.id === id).anchors);
      }
    }
    return { label, anchors: [...new Set(anchors)], genres };
  }

  // The other things a post could be about, for "Only show me X": every genre
  // and subject none of the show topics named. Returns their anchors.
  function otherSubjects(intent) {
    const named = new Set(intent.show.flatMap((t) => t.genres));
    const anchors = [...GENRES, ...SUBJECTS].filter((g) => !named.has(g.id)).flatMap((g) => g.anchors);
    return [...new Set(anchors)];
  }

  // Returns { only, hide: Topic[], show: Topic[], more: string[] }.
  // "show" topics only constrain the feed when `only` is set; "more of X"
  // is never a reason to hide anything.
  function parseInstructions(text) {
    const out = { only: false, hide: [], show: [], more: [] };
    const clauses = String(text || '')
      .split(/[\n.;!?]+|\bbut\b/i)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const clause of clauses) {
      const neg = firstIndex(NEG_RE, clause);
      const only = firstIndex(ONLY_RE, clause);
      const topic = cleanTopic(clause);
      if (!topic) continue;
      if (only < neg) {
        out.only = true;
        out.show.push(makeTopic(topic));
      } else if (neg < Infinity) {
        out.hide.push(makeTopic(topic));
      } else if (MORE_RE.test(clause)) {
        out.more.push(topic);
      } else {
        // A bare phrase ("crypto") in a filter box almost always means "hide".
        out.hide.push(makeTopic(topic));
      }
    }
    return out;
  }

  control.intent = { parseInstructions, otherSubjects, GENRES, SUBJECTS };
})(globalThis);
