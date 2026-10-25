// Decision logic for the on-device filter. Pure functions over cosine
// similarities, so it runs the same in the offscreen page and in Node tests.
//
// Raw similarity scales differ per topic, so each topic keeps running stats
// of how similar ordinary feed posts are to it, and a post is judged by its
// z-score: "how unusually close is this post to the topic?". Stats start
// from a prior measured on our eval set, so the first posts are judged
// sensibly before the feed has taught us anything.
(function (root) {
  const control = (root.control = root.control || {});

  // Calibrated for Xenova/gte-small (q8) on 60 labelled LinkedIn-style posts
  // x 10 filter scenarios (see README "Model choice").
  const CONFIG = {
    zThreshold: 1.26, // z >= this means the post matches the topic
    // "Only show X" mode is stricter on itself: a wrongly hidden post costs the
    // user something they wanted. 0.8 cut wanted-but-hidden posts from 5 to 2
    // on the eval set for 0.8 points of accuracy.
    onlyThreshold: 0.8,
    band: 0.5, // |z - threshold| < band means uncertain
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
  // sims: { hide: number[], show: number[] }   one per topic
  // stats: { hide: Stats[], show: Stats[] }    one per topic
  // -> { decision: 'show'|'hide', reason, uncertain }
  function judge(intent, sims, stats, cfg = CONFIG) {
    const h = intent.hide.length ? side(intent.hide, sims.hide, stats.hide, cfg) : null;
    const s = intent.only && intent.show.length ? side(intent.show, sims.show, stats.show, cfg, cfg.onlyThreshold) : null;
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

  control.localFilter = { CONFIG, judge, observe, topicSims, newIntentStats, zScore, newStats, addSample };
})(globalThis);
