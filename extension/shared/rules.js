// Cheap, deterministic filters that run before any AI: structural modes
// (promoted, network activity, suggested) and keyword matching. Pure
// functions over an extracted post object, so they're unit-testable in Node.
(function (root) {
  const control = (root.control = root.control || {});

  // Header lines LinkedIn puts above a post when it's there because of
  // someone in your network rather than because you follow the author:
  // "Sam likes this", "Sam and 3 others like this", "Sam commented on this",
  // and in 2026 markup just "Sam commented". Anchored to the end of the line
  // so a headline like "Shared services lead" doesn't count. English only.
  const SOCIAL_RE =
    /\b(?:(?:likes?|loves?|celebrates?|supports?|reacted to|commented on|reposted|shared|is curious about) this|finds? this (?:insightful|funny)|commented|reposted|replied to a comment)$/i;
  const SUGGESTED_RE =
    /^(?:suggested|recommended for you|popular (?:in|on|with)\b|based on your\b|because you (?:follow|viewed)\b)/i;
  const PROMOTED_RE = /^promoted(?:\s+by\b.*)?$/i;

  function classifyHeader(headerText) {
    // Drop trailing punctuation/icons ("Sam likes this ·").
    const text = (headerText || '').trim().replace(/[^\p{L}\p{N}]+$/u, '');
    if (!text || text.length > 160) return null;
    if (SUGGESTED_RE.test(text)) return 'suggested';
    if (SOCIAL_RE.test(text)) return 'social';
    return null;
  }

  function isPromotedLabel(text) {
    return PROMOTED_RE.test((text || '').trim());
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }

  // post: { isPromoted, headerKind, headerText }
  // modes: settings.modes
  // Returns { kind, reason } when a mode hides the post, otherwise null.
  function evaluateModes(post, modes) {
    if (modes.hidePromoted && post.isPromoted) {
      return { kind: 'promoted', reason: 'Promoted' };
    }
    if (modes.hideSuggested && post.headerKind === 'suggested') {
      return { kind: 'suggested', reason: 'Suggested by LinkedIn' };
    }
    if (modes.hideSocialActivity && post.headerKind === 'social') {
      return { kind: 'social', reason: truncate(post.headerText || 'Activity from your network', 60) };
    }
    return null;
  }

  const WORD_CHAR = '[\\p{L}\\p{N}_]';
  const STARTS_WITH_WORD = /^[\p{L}\p{N}_]/u;
  const ENDS_WITH_WORD = /[\p{L}\p{N}_]$/u;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Keyword syntax:
  //   internship       whole word, case-insensitive, also matches "internships"
  //   thrilled to announce   phrase, any whitespace between words
  //   intern*          prefix: intern, interns, internship, internal, ...
  //   #hiring, agree?  punctuation is matched literally
  function keywordToRegExp(raw) {
    let kw = String(raw || '').trim();
    let prefix = false;
    if (kw.endsWith('*')) {
      prefix = true;
      kw = kw.slice(0, -1).trim();
    }
    if (!kw) return null;
    const body = kw.split(/\s+/).map(escapeRegExp).join('\\s+');
    const start = STARTS_WITH_WORD.test(kw) ? `(?<!${WORD_CHAR})` : '';
    const end = ENDS_WITH_WORD.test(kw) && !prefix ? `(?:s|es)?(?!${WORD_CHAR})` : '';
    return new RegExp(start + body + end, 'iu');
  }

  function compileKeywords(list) {
    const out = [];
    for (const raw of list || []) {
      const re = keywordToRegExp(raw);
      if (re) out.push({ keyword: String(raw).trim(), re });
    }
    return out;
  }

  // Returns the first keyword that matches, or null.
  function matchKeywords(text, compiled) {
    if (!text) return null;
    for (const { keyword, re } of compiled) {
      if (re.test(text)) return keyword;
    }
    return null;
  }

  // Runs features 1 and 2 in order. Returns { kind, reason } or null.
  function evaluateRules(post, settings, compiledKeywords) {
    const byMode = evaluateModes(post, settings.modes);
    if (byMode) return byMode;
    if (settings.keywords.enabled) {
      const hit = matchKeywords(post.text, compiledKeywords);
      if (hit) return { kind: 'keyword', reason: `Keyword: ${hit}` };
    }
    return null;
  }

  control.rules = {
    classifyHeader,
    isPromotedLabel,
    evaluateModes,
    keywordToRegExp,
    compileKeywords,
    matchKeywords,
    evaluateRules,
  };
})(globalThis);
