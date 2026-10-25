// Decision logic for the on-device filter. Pure functions over cosine
// similarities, so it runs the same in the offscreen page and in Node tests.
//
// Raw similarity scales differ per topic, so each topic keeps running stats
// of how similar ordinary feed posts are to it, and a post is judged by its
// z-score: "how unusually close is this post to the topic?". Stats start
// from a prior measured on our eval set, so the first posts are judged
// sensibly before the feed has taught us anything.
//
// "Only show me X" has a second way in. Z-scores rank a post against the
// user's own feed, so when most of the feed IS about X (technology, on
// LinkedIn) only the top few can clear the bar and most wanted posts are
// hidden. So a post also counts as X when it's closer to X than to every
// other subject a LinkedIn post tends to be about (intent.otherSubjects),
// which doesn't depend on what the rest of the feed looks like.
(function (root) {
  const control = (root.control = root.control || {});

  // Calibrated for Xenova/gte-small (q8) on 83 labelled LinkedIn-style posts
  // x 13 filter scenarios (eval/, see README "Model choice").
  const CONFIG = {
    zThreshold: 1.26, // z >= this means the post matches the topic
    // "Only show X" mode is stricter on itself: a wrongly hidden post costs the
    // user something they wanted. Measured with the nearest-subject rule below.
    onlyThreshold: 1.0,
    band: 0.5, // |z - threshold| < band means uncertain
    // Only-mode, second way in: a post is about X if it's closer to X than to
    // every other subject (margin 0). On feeds that are ~75% on-topic this
    // keeps 41 of 48 wanted posts (z-scores alone: 23) and hides 18 of 18
    // unwanted ones, and overall accuracy goes from 0.921 to 0.951.
    nearMargin: 0,
    nearBand: 0.01, // |lead| < this means uncertain
    // Other subjects this close to one of X's own anchors count as X, not as
    // competition.
    overlap: 0.85,
    priorMean: 0.778,
    priorSd: 0.036,
    priorN: 20, // how many posts the prior is worth
  };

  function newStats() {
    return { n: 0, sum: 0, sumSq: 0 };
  }

  function addSample(stats, x) {
    stats.n++;
    stats.sum += x;
    stats.sumSq += x * x;
  }

  function zScore(stats, x, cfg = CONFIG) {
    const N = cfg.priorN + stats.n;
    const mean = (cfg.priorN * cfg.priorMean + stats.sum) / N;
    const ex2 = (cfg.priorN * (cfg.priorSd ** 2 + cfg.priorMean ** 2) + stats.sumSq) / N;
    const sd = Math.sqrt(Math.max(ex2 - mean * mean, 1e-6));
    return (x - mean) / sd;
  }

  function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s; // vectors are already normalised
  }

  // Best similarity of a post vector to each topic (max over its anchors).
  function topicSims(postVec, topicVecs) {
    return topicVecs.map((anchors) => Math.max(...anchors.map((a) => cosine(postVec, a))));
  }

  // Anchors of the other subjects, minus those that overlap the show topics.
  function competingAnchors(showVecs, otherVecs, cfg = CONFIG) {
    const own = showVecs.flat();
    return otherVecs.filter((o) => !own.some((a) => cosine(a, o) >= cfg.overlap));
  }

  // Similarity of a post to the closest competing subject (null if none).
  function otherSim(postVec, competing) {
    return competing.length ? Math.max(...competing.map((a) => cosine(postVec, a))) : null;
  }

  function side(topics, sims, stats, cfg, threshold = cfg.zThreshold) {
    let best = { z: -Infinity, i: -1 };
    sims.forEach((s, i) => {
      const z = zScore(stats[i], s, cfg);
      if (z > best.z) best = { z, i };
    });
    const d = best.z - threshold;
    return {
      z: best.z,
      label: best.i >= 0 ? topics[best.i].label : '',
      match: d >= 0,
      sure: Math.abs(d) >= cfg.band,
    };
  }

  function short(text, n = 40) {
    return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text;
  }

  // intent: from control.intent.parseInstructions
  // sims: { hide: number[], show: number[], other?: number|null }   one per topic
  // stats: { hide: Stats[], show: Stats[] }    one per topic
  // -> { decision: 'show'|'hide', reason, uncertain }
  function judge(intent, sims, stats, cfg = CONFIG) {
    const h = intent.hide.length ? side(intent.hide, sims.hide, stats.hide, cfg) : null;
    const s = intent.only && intent.show.length ? side(intent.show, sims.show, stats.show, cfg, cfg.onlyThreshold) : null;
    if (s && !s.match && sims.other != null) {
      const lead = Math.max(...sims.show) - sims.other - cfg.nearMargin;
      s.match = lead >= 0;
      if (s.match) s.sure = lead >= cfg.nearBand;
    }
    const uncertain = Boolean((h && !h.sure) || (s && !s.sure));
    if (h && h.match) return { decision: 'hide', reason: 'Looks like ' + short(h.label), uncertain };
    if (s && !s.match) {
      const want = intent.show.map((t) => t.label).join(' / ');
      return { decision: 'hide', reason: 'Not about ' + short(want), uncertain };
    }
    return { decision: 'show', reason: '', uncertain };
  }

  // Feed one post's similarities into the running stats.
  function observe(sims, stats) {
    sims.hide.forEach((x, i) => addSample(stats.hide[i], x));
    sims.show.forEach((x, i) => addSample(stats.show[i], x));
  }

  function newIntentStats(intent) {
    return { hide: intent.hide.map(newStats), show: intent.show.map(newStats) };
  }

  control.localFilter = {
    CONFIG,
    judge,
    observe,
    topicSims,
    competingAnchors,
    otherSim,
    newIntentStats,
    zScore,
    newStats,
    addSample,
  };
})(globalThis);
