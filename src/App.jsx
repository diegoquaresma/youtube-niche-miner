import { useState, useRef, useEffect, useMemo } from "react";

const YT = "https://www.googleapis.com/youtube/v3";

async function ytFetch(apiKey, path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${YT}${path}${sep}key=${apiKey}`);
  const data = await res.json();
  if (data.error) throw new Error((data.error.message || "").replace(/<[^>]*>/g, ""));
  return data;
}

function formatViews(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toString();
}

function formatVPH(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return Math.round(n).toString();
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

function formatAge(hoursOld) {
  if (!hoursOld || hoursOld < 1) return "< 1h atrás";
  if (hoursOld < 24) return `${Math.round(hoursOld)}h atrás`;
  const days = Math.round(hoursOld / 24);
  return `${days}d atrás`;
}

function parseDuration(iso) {
  if (!iso) return { sec: 0, str: "—" };
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return { sec: 0, str: "—" };
  const h = Number(m[1] || 0), min = Number(m[2] || 0), s = Number(m[3] || 0);
  const sec = h * 3600 + min * 60 + s;
  if (h > 0) return { sec, str: `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}` };
  return { sec, str: `${min}:${String(s).padStart(2, "0")}` };
}

function publishedAfterDate(period) {
  const d = new Date();
  if (period === "today") { d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (period === "week")  { d.setDate(d.getDate() - 7); return d.toISOString(); }
  if (period === "month") { d.setMonth(d.getMonth() - 1); return d.toISOString(); }
  if (period === "year")  { d.setFullYear(d.getFullYear() - 1); return d.toISOString(); }
  return null;
}

const STOPWORDS = new Set([
  "de","da","do","das","dos","para","com","em","e","o","a","os","as",
  "um","uma","uns","umas","que","se","na","no","nos","nas","ao","aos",
  "por","pelo","pela","pelos","pelas","mais","mas","ou","como","quando",
  "seu","sua","seus","suas","este","esta","esse","essa","isso","aqui",
  "meu","minha","voce","eu","ele","ela","nos","eles","elas","tudo","todo",
  "toda","todos","todas","veja","vou","vai","ter","sem","nao","sim",
  "tambem","ainda","ja","agora","nova","novo","deu","diz","faz","fez",
  "foi","vem","sobre","depois","antes","muito","pouco","fazer","qual",
  "quem","sera","pode","aula","video","live","parte","part","vlog","ep",
  "vol","ft","vs","feat","the","and","for","with","this","that","have",
  "from","are","your","you","how","what","why","when","who","will","can",
]);

async function extractChannelKeywords(apiKey, channelId) {
  const data = await ytFetch(apiKey,
    `/search?part=snippet&channelId=${channelId}&type=video&maxResults=25&order=viewCount`
  );
  const items = data.items || [];
  if (!items.length) return { keywords: [], query: "" };
  const counts = {};
  for (const item of items) {
    const title = item.snippet.title || "";
    const words = title
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    for (const w of words) counts[w] = (counts[w] || 0) + 1;
  }
  let keywords = Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);
  if (keywords.length < 3) {
    keywords = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
  }
  return { keywords, query: keywords.join(" ") };
}

async function searchSimilarChannels(apiKey, channelId) {
  const { keywords, query } = await extractChannelKeywords(apiKey, channelId);
  if (!query) throw new Error("Não foi possível extrair o tema do canal.");
  const data = await ytFetch(apiKey,
    `/search?part=snippet&q=${encodeURIComponent(query)}&type=channel&maxResults=16`
  );
  const items = (data.items || []).filter(i => i.id.channelId !== channelId).slice(0, 15);
  if (!items.length) return { channels: [], keywords, query };
  const ids = items.map(i => i.id.channelId).join(",");
  const chData = await ytFetch(apiKey, `/channels?part=statistics,snippet&id=${ids}`);
  const chMap = {};
  for (const c of chData.items || []) chMap[c.id] = c;
  const channels = items.map((item, idx) => {
    const id = item.id.channelId;
    const info = chMap[id];
    const subs = Number(info?.statistics?.subscriberCount) || 0;
    const vids = Number(info?.statistics?.videoCount) || 0;
    const thumbnail =
      info?.snippet?.thumbnails?.high?.url ||
      info?.snippet?.thumbnails?.medium?.url ||
      info?.snippet?.thumbnails?.default?.url || "";
    return {
      name: info?.snippet?.title || item.snippet.channelTitle,
      url: `https://www.youtube.com/channel/${id}`,
      thumbnail,
      subscribers: subs ? formatViews(subs) : "—",
      subscribersRaw: subs,
      totalVideos: vids ? `${vids} vídeos` : "—",
      description: info?.snippet?.description?.slice(0, 130) || "",
      similarityScore: Math.max(55, 92 - idx * 3),
    };
  });
  return { channels, keywords, query };
}

const COUNTRY_LANG = {
  BR:"pt", PT:"pt", MX:"es", AR:"es", CO:"es", CL:"es", ES:"es", VE:"es", PE:"es",
  US:"en", GB:"en", CA:"en", AU:"en",
  DE:"de", FR:"fr", IT:"it", JP:"ja", IN:"hi",
};

// Translates a query to the target language via MyMemory free API
async function translateQuery(text, targetLang, sourceLang = "pt") {
  if (!text || !targetLang || targetLang === sourceLang) return text;
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`
    );
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
  } catch (_) { /* fallback to original text */ }
  return text;
}

async function searchVideos(apiKey, query, filters, pageToken = null) {
  const tipo = filters.tipo || "video";

  // Determine target language from selected country
  const targetLang = filters.country ? COUNTRY_LANG[filters.country] : null;

  // Seed words per language — used when no query is typed but a country is selected
  const LANG_SEEDS = { pt:"vídeo", es:"video", en:"video", de:"video", fr:"vidéo", it:"video", ja:"動画", hi:"वीडियो" };

  // Translate or seed the query
  let baseQuery = query;
  if (targetLang) {
    if (query) {
      baseQuery = await translateQuery(query, targetLang);
    } else if (tipo === "video" || tipo === "shorts") {
      // No user query: inject a seed in the target language so relevanceLanguage takes effect
      baseQuery = LANG_SEEDS[targetLang] || "video";
    }
  }

  // For Shorts: append #shorts to the search query
  const searchQuery = tipo === "shorts" ? `${baseQuery} #shorts` : baseQuery;

  // ── No-query + no-country: use videos?chart=mostPopular (global trending) ─
  if (!query && !filters.country && (tipo === "video" || tipo === "shorts")) {
    const vp = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      chart: "mostPopular",
      maxResults: 50,
    });
    if (filters.data) { const after = publishedAfterDate(filters.data); if (after) vp.set("publishedAfter", after); }

    const videoData = await ytFetch(apiKey, `/videos?${vp}`);
    const popularItems = videoData.items || [];
    if (!popularItems.length) return { items: [], nextPageToken: null };

    const uniqueCh = [...new Set(popularItems.map(i => i.snippet.channelId))].join(",");
    const chData   = await ytFetch(apiKey, `/channels?part=snippet,statistics&id=${uniqueCh}`);
    const chMap2 = {};
    for (const c of chData.items || []) {
      chMap2[c.id] = {
        thumbnail:   c.snippet?.thumbnails?.medium?.url || c.snippet?.thumbnails?.default?.url || "",
        subscribers: Number(c.statistics?.subscriberCount) || 0,
        totalViews:  Number(c.statistics?.viewCount)       || 0,
        videoCount:  Number(c.statistics?.videoCount)      || 1,
      };
    }

    const items = popularItems.map(item => {
      const id     = item.id;
      const stats  = item.statistics || {};
      const dur    = parseDuration(item.contentDetails?.duration);
      const views  = Number(stats.viewCount) || 0;
      const ch     = chMap2[item.snippet.channelId] || {};
      const rawH   = (Date.now() - new Date(item.snippet.publishedAt)) / 36e5;
      return {
        type: "video", videoId: id,
        url:  `https://www.youtube.com/watch?v=${id}`,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        channelUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`,
        channelThumbnail: ch.thumbnail || "",
        channelSubscribers: ch.subscribers,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
        views: formatViews(views), viewsRaw: views,
        vph: views / Math.max(1, rawH),
        outlier: calcOutlier(views, ch.totalViews, ch.videoCount),
        hoursOld: rawH,
        likesRaw: Number(stats.likeCount) || 0,
        commentsRaw: Number(stats.commentCount) || 0,
        durationSec: dur.sec, durationStr: dur.str,
        publishedAt: formatDate(item.snippet.publishedAt),
        description: item.snippet.description?.slice(0, 120) || "",
      };
    }).sort((a, b) => b.viewsRaw - a.viewsRaw);
    return { items, nextPageToken: null };
  }

  // ── Normal search path ────────────────────────────────────────────────────
  const params = new URLSearchParams({
    part: "snippet",
    maxResults: 50,
    order: filters.ordem || "viewCount",
  });
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  if (pageToken) params.set("pageToken", pageToken);

  if (tipo === "movie") {
    params.set("type", "video");
    params.set("videoType", "movie");
  } else if (tipo === "channel") {
    params.set("type", "channel");
  } else if (tipo === "playlist") {
    params.set("type", "playlist");
  } else {
    params.set("type", "video");
  }

  if (filters.country) {
    params.set("regionCode", filters.country);
    if (targetLang) params.set("relevanceLanguage", targetLang);
  }
  if (filters.channelId) params.set("channelId", filters.channelId);

  const isVideoType = tipo === "video" || tipo === "shorts" || tipo === "movie";
  if (isVideoType) {
    if (tipo === "shorts") {
      params.set("videoDuration", "short");
    } else if (filters.duracao) {
      params.set("videoDuration", filters.duracao);
    }
    if (filters.data) {
      const after = publishedAfterDate(filters.data);
      if (after) params.set("publishedAfter", after);
    }
    if (filters.caracteristicas?.includes("hd"))         params.set("videoDefinition", "high");
    if (filters.caracteristicas?.includes("cc"))          params.set("videoCaption", "closedCaption");
    if (filters.caracteristicas?.includes("live"))        params.set("eventType", "live");
    if (filters.caracteristicas?.includes("cc_license"))  params.set("videoLicense", "creativeCommon");
    if (filters.caracteristicas?.includes("3d"))          params.set("videoDimension", "3d");
  }

  const searchData = await ytFetch(apiKey, `/search?${params}`);
  const rawItems = searchData.items || [];
  const searchNextPageToken = searchData.nextPageToken || null;
  if (!rawItems.length) return { items: [], nextPageToken: null };

  if (tipo === "channel") {
    const channelOnly = rawItems.filter(i => i.id?.channelId && !i.id?.videoId);
    if (!channelOnly.length) return { items: [], nextPageToken: null };
    const chIds = channelOnly.map(i => i.id.channelId).join(",");
    const chData = await ytFetch(apiKey, `/channels?part=statistics,snippet&id=${chIds}`);
    const map = {};
    for (const c of chData.items || []) map[c.id] = c;
    return {
      items: channelOnly.map(item => {
        const id = item.id.channelId;
        const info = map[id];
        const subs = Number(info?.statistics?.subscriberCount) || 0;
        return {
          type: "channel", channelId: id,
          url: `https://www.youtube.com/channel/${id}`,
          title: info?.snippet?.title || item.snippet.channelTitle,
          channel: info?.snippet?.title || item.snippet.channelTitle,
          thumbnail: info?.snippet?.thumbnails?.high?.url || info?.snippet?.thumbnails?.medium?.url || "",
          views: formatViews(subs), viewsRaw: subs,
          publishedAt: "", description: info?.snippet?.description?.slice(0, 120) || "",
          hoursOld: 0, likesRaw: 0, commentsRaw: 0, durationSec: 0, durationStr: "—",
        };
      }),
      nextPageToken: searchNextPageToken,
    };
  }

  if (tipo === "playlist") {
    return {
      items: rawItems.map(item => ({
        type: "playlist", videoId: item.id.playlistId,
        url: `https://www.youtube.com/playlist?list=${item.id.playlistId}`,
        title: item.snippet.title, channel: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        thumbnail: item.snippet.thumbnails?.medium?.url || "",
        views: "—", viewsRaw: 0,
        publishedAt: formatDate(item.snippet.publishedAt),
        description: item.snippet.description?.slice(0, 120) || "",
        hoursOld: 0, likesRaw: 0, commentsRaw: 0, durationSec: 0, durationStr: "—",
      })),
      nextPageToken: searchNextPageToken,
    };
  }

  const videoIds = rawItems.map(i => i.id.videoId).filter(Boolean).join(",");
  if (!videoIds) return { items: [], nextPageToken: null };

  const videoItems = rawItems.filter(i => i.id.videoId);
  const uniqueChannelIds = [...new Set(videoItems.map(i => i.snippet.channelId))].join(",");
  const [statsData, chData] = await Promise.all([
    ytFetch(apiKey, `/videos?part=statistics,contentDetails&id=${videoIds}`),
    ytFetch(apiKey, `/channels?part=snippet,statistics&id=${uniqueChannelIds}`),
  ]);

  const statsMap = {};
  for (const s of statsData.items || []) {
    statsMap[s.id] = { stats: s.statistics, dur: parseDuration(s.contentDetails?.duration) };
  }

  const chMap = {};
  for (const c of chData.items || []) {
    chMap[c.id] = {
      thumbnail:   c.snippet?.thumbnails?.medium?.url || c.snippet?.thumbnails?.default?.url || "",
      subscribers: Number(c.statistics?.subscriberCount) || 0,
      totalViews:  Number(c.statistics?.viewCount)       || 0,
      videoCount:  Number(c.statistics?.videoCount)      || 1,
    };
  }

  // Group result views by channel to build a peer-based baseline when possible
  const peerViewsMap = {}; // channelId -> [views]
  for (const item of videoItems) {
    const views = Number(statsMap[item.id.videoId]?.stats?.viewCount) || 0;
    const chId  = item.snippet.channelId;
    if (!peerViewsMap[chId]) peerViewsMap[chId] = [];
    peerViewsMap[chId].push(views);
  }

  return {
    items: videoItems
      .map(item => {
        const id       = item.id.videoId;
        const si       = statsMap[id] || {};
        const stats    = si.stats || {};
        const dur      = si.dur || { sec: 0, str: "—" };
        const views    = Number(stats.viewCount) || 0;
        const ch       = chMap[item.snippet.channelId] || {};
        const rawHours = (Date.now() - new Date(item.snippet.publishedAt)) / 36e5;
        const vph      = views / Math.max(1, rawHours);
        // Use peer average from results when ≥3 videos from same channel, else channel total
        const peers = peerViewsMap[item.snippet.channelId] || [];
        const outlier = peers.length >= 3
          ? calcOutlierFromPeers(views, peers)
          : calcOutlier(views, ch.totalViews, ch.videoCount);
        return {
          type: "video", videoId: id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          channelId: item.snippet.channelId,
          channelUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`,
          channelThumbnail: ch.thumbnail || "",
          channelSubscribers: ch.subscribers,
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
          views: formatViews(views), viewsRaw: views,
          vph, outlier,
          hoursOld: rawHours,
          likesRaw: Number(stats.likeCount) || 0,
          commentsRaw: Number(stats.commentCount) || 0,
          durationSec: dur.sec,
          durationStr: dur.str,
          publishedAt: formatDate(item.snippet.publishedAt),
          description: item.snippet.description?.slice(0, 120) || "",
        };
      })
      .sort((a, b) => b.viewsRaw - a.viewsRaw),
    nextPageToken: searchNextPageToken,
  };
}

function analyzeNiche(videos) {
  const vids = videos.filter(v => v.type === "video");
  if (!vids.length) return null;
  const totalViews = vids.reduce((s, v) => s + v.viewsRaw, 0);
  const avgViews = Math.round(totalViews / vids.length);
  const uniqueChannels = new Set(vids.map(v => v.channelId)).size;
  const viewScore = Math.min((avgViews / 300000) * 55, 55);
  const channelPenalty = Math.min(uniqueChannels * 4, 35);
  const opportunityScore = Math.round(Math.max(10, Math.min(95, viewScore + 45 - channelPenalty)));
  const saturationLevel = uniqueChannels <= 4 ? "Baixo" : uniqueChannels <= 9 ? "Médio" : "Alto";
  const recommendation = opportunityScore >= 70
    ? `Boa oportunidade: ${uniqueChannels} canais e média de ${formatViews(avgViews)} views. Vale explorar.`
    : opportunityScore >= 40
    ? `Nicho moderado: ${uniqueChannels} canais e ${formatViews(avgViews)} views em média. Diferenciação é chave.`
    : `Nicho saturado: ${uniqueChannels} canais ativos. Foque em sub-nichos mais específicos.`;
  return { opportunityScore, saturationLevel, avgViews: formatViews(avgViews), totalChannels: uniqueChannels, recommendation };
}

// ─── Design system ────────────────────────────────────────────────────────────
const PALETTE = [
  ["#312E81","#818CF8"], ["#064E3B","#34D399"], ["#7C2D12","#FB923C"],
  ["#1E1B4B","#A5B4FC"], ["#134E4A","#5EEAD4"], ["#4C1D95","#C084FC"],
  ["#7F1D1D","#F87171"], ["#1E3A5F","#60A5FA"],
];
const channelColor = (name) => PALETTE[(name || " ").charCodeAt(0) % PALETTE.length];

const isDark = () => document.body.classList.contains("dark");

const scoreColor = (s) => {
  const d = isDark();
  if (s >= 70) return d
    ? { bg:"rgba(16,185,129,0.18)",  text:"#34D399", border:"#059669", label:"Alta"  }
    : { bg:"#D1FAE5",                text:"#064E3B", border:"#6EE7B7", label:"Alta"  };
  if (s >= 40) return d
    ? { bg:"rgba(251,191,36,0.18)",  text:"#FCD34D", border:"#D97706", label:"Média" }
    : { bg:"#FEF3C7",                text:"#78350F", border:"#FCD34D", label:"Média" };
  return d
    ? { bg:"rgba(248,113,113,0.18)", text:"#F87171", border:"#DC2626", label:"Baixa" }
    : { bg:"#FEE2E2",                text:"#7F1D1D", border:"#FCA5A5", label:"Baixa" };
};

const satColor = (l) => {
  const d = isDark();
  if (l === "Baixo") return d
    ? { bg:"rgba(16,185,129,0.18)",  text:"#34D399" }
    : { bg:"#D1FAE5",                text:"#064E3B" };
  if (l === "Médio") return d
    ? { bg:"rgba(251,191,36,0.18)",  text:"#FCD34D" }
    : { bg:"#FEF3C7",                text:"#78350F" };
  return d
    ? { bg:"rgba(248,113,113,0.18)", text:"#F87171" }
    : { bg:"#FEE2E2",                text:"#7F1D1D" };
};

function parseViewsInput(str) {
  if (!str) return 0;
  const s = str.trim().toLowerCase().replace(/,/g, "").replace(/\./g, "");
  if (s.endsWith("m")) return parseFloat(s) * 1e6;
  if (s.endsWith("k")) return parseFloat(s) * 1e3;
  return parseFloat(s) || 0;
}

function outlierBadge(x) {
  if (!x || x <= 0) return null;
  if (x >= 5)   return { bg:"#DC2626", text:"#fff", label:`VIRAL 🔥 ${x.toFixed(1)}x` };
  if (x >= 2)   return { bg:"#059669", text:"#fff", label:`OUTLIER ⬆ ${x.toFixed(1)}x` };
  if (x >= 1)   return { bg:"#2563EB", text:"#fff", label:`ACIMA ↑ ${x.toFixed(1)}x` };
  if (x >= 0.5) return { bg:"#6B7280", text:"#fff", label:`MÉDIO ${x.toFixed(1)}x` };
  return         { bg:"#B91C1C", text:"#fff", label:`ABAIXO ↓ ${x.toFixed(1)}x` };
}

function trendSignal(video) {
  const h    = video.hoursOld || 0;
  const days = h / 24;
  const views   = video.viewsRaw || 0;
  const outlier = video.outlier  || 0;

  if (h < 24 && views >= 6000 && outlier >= 5)
    return { dot:"🟢", label:"VIRAL EXPLOSIVO",          color:"#00FF88", textColor:"#003D20", bg:"rgba(0,255,136,0.15)", border:"#00FF88" };
  if (days <= 3)
    return { dot:"🟢", label:"MUITO PROMISSOR",           color:"#22C55E", textColor:"#14532D", bg:"#F0FDF4",             border:"#86EFAC" };
  if (days <= 5)
    return { dot:"🟡", label:"CRESCIMENTO SAUDÁVEL",      color:"#EAB308", textColor:"#713F12", bg:"#FEFCE8",             border:"#FDE047" };
  if (days <= 7)
    return { dot:"🟠", label:"MOMENTUM DESACELERANDO",    color:"#F97316", textColor:"#7C2D12", bg:"#FFF7ED",             border:"#FED7AA" };
  if (days <= 10)
    return { dot:"🔴", label:"OPORTUNIDADE ENFRAQUECENDO",color:"#EF4444", textColor:"#7F1D1D", bg:"#FEF2F2",             border:"#FECACA" };
  return   { dot:"🔴", label:"TENDÊNCIA ENCERRADA",       color:"#991B1B", textColor:"#450A0A", bg:"#FEE2E2",             border:"#FCA5A5" };
}

function medianOf(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function calcOutlier(views, chTotalViews, chVideoCount) {
  // Fallback when we only have channel totals (search path, single video)
  const total = chTotalViews || 0;
  const count = chVideoCount || 1;
  const rawAvg = total > 0 ? total / count : 0;
  const baseV = total - views;
  const baseN = count - 1;
  const baseline = baseN >= 1 && baseV > 0 ? baseV / baseN : rawAvg;
  return baseline > 0 ? views / baseline : 0;
}

function calcOutlierFromPeers(views, allChannelViews) {
  // Use median of other videos as baseline — resistant to a single viral outlier skewing the avg
  const others = allChannelViews.filter(v => v !== views);
  if (!others.length) return 0;
  const baseline = medianOf(others);
  return baseline > 0 ? views / baseline : 0;
}

function calcOpportunityScore(video) {
  const subs    = video.channelSubscribers || 0;
  const outlier = video.outlier  || 0;
  const views   = video.viewsRaw || 0;
  const h       = video.hoursOld || 0;

  // === SIGNAL 1: Absolute velocity — proves topic demand (primary, channel-size-agnostic) ===
  let velocityScore = 0;
  if (h <= 24) {
    if      (views >= 100000) velocityScore = 80;
    else if (views >=  50000) velocityScore = 70;
    else if (views >=  20000) velocityScore = 60;
    else if (views >=  10000) velocityScore = 50;
    else if (views >=   6000) velocityScore = 40;
    else if (views >=   2000) velocityScore = 25;
    else                      velocityScore = (views / 2000) * 25;
  } else if (h <= 72) {
    // still fresh — apply 0.85 decay
    if      (views >= 500000) velocityScore = 68;
    else if (views >= 200000) velocityScore = 60;
    else if (views >=  50000) velocityScore = 51;
    else if (views >=  20000) velocityScore = 43;
    else if (views >=  10000) velocityScore = 32;
    else                      velocityScore = (views / 10000) * 32;
  } else if (h <= 168) {
    // 3–7 days — 0.70 decay
    if      (views >= 1000000) velocityScore = 56;
    else if (views >=  500000) velocityScore = 49;
    else if (views >=  100000) velocityScore = 42;
    else if (views >=   20000) velocityScore = 31;
    else                       velocityScore = (views / 20000) * 31;
  } else {
    // >7 days — 0.40 decay, trend fading
    if      (views >= 1000000) velocityScore = 32;
    else if (views >=  500000) velocityScore = 26;
    else if (views >=  100000) velocityScore = 18;
    else                       velocityScore = (views / 100000) * 18;
  }

  // === SIGNAL 2: Outlier bonus — confirms above-average performance for channel size (secondary) ===
  let outlierBonus = 0;
  if      (subs <   50000) outlierBonus = Math.min(20, (outlier / 6) * 20);
  else if (subs <  500000) outlierBonus = Math.min(20, (outlier / 4) * 15);
  else if (subs < 2000000) outlierBonus = Math.min(15, (outlier / 3) * 10);
  else                     outlierBonus = Math.min(10, (outlier / 2) *  5);

  const score = Math.min(100, Math.round(velocityScore + outlierBonus));

  if (score >= 75) return { score, label:"Explosivo", emoji:"🔥", color:"#DC2626", bg:"#FEF2F2", border:"#FECACA" };
  if (score >= 50) return { score, label:"Promissor",  emoji:"⚡", color:"#D97706", bg:"#FFFBEB", border:"#FCD34D" };
  if (score >= 25) return { score, label:"Relevante",  emoji:"✅", color:"#059669", bg:"#F0FDF4", border:"#86EFAC" };
  return              { score, label:"Normal",     emoji:"—",  color:"var(--t4)", bg:"var(--surface2)", border:"var(--border)" };
}

function classifyVideo(video) {
  const days    = (video.hoursOld || 0) / 24;
  const outlier = video.outlier || 0;
  const vph     = video.vph     || 0;
  const views   = video.viewsRaw || 0;

  if (outlier >= 5 && days < 3)                        return "VIRAL EXPLOSIVO";
  if (outlier >= 2 && days < 5)                        return "VIRAL EM ASCENSÃO";
  if (days > 30 && views > 500000)                     return "EVERGREEN FORTE";
  if (days > 10 && vph < 10)                           return "TENDÊNCIA ENCERRADA";
  if (days > 7  && vph < 50)                           return "OPORTUNIDADE ATRASADA";
  if (outlier < 0.5 && days > 3)                       return "SATURANDO";
  if (vph > 200 && outlier >= 1 && days < 7)           return "POSSÍVEL HIT";
  if (days > 7)                                        return "MORRENDO";
  return "POSSÍVEL HIT";
}

function projectVPH(video) {
  const vph     = video.vph      || 0;
  const views   = video.viewsRaw || 0;
  const h       = video.hoursOld || 1;
  const days    = h / 24;

  // Geometric decay model: geoViews = VPH * 24 * (1 - decay^days) / (1 - decay)
  const geo = (v, d, decay) =>
    decay >= 1 ? Math.round(v * 24 * d) : Math.round(v * 24 * (1 - Math.pow(decay, d)) / (1 - decay));

  const h24 = { agg: geo(vph, 1, 0.85), real: geo(vph, 1, 0.60), cons: geo(vph, 1, 0.35) };
  const h72 = { agg: geo(vph, 3, 0.85), real: geo(vph, 3, 0.60), cons: geo(vph, 3, 0.35) };
  const d7  = { agg: geo(vph, 7, 0.85), real: geo(vph, 7, 0.60), cons: geo(vph, 7, 0.35) };

  const finalPotential = {
    agg:  Math.round(views + d7.agg  * 4.3),
    real: Math.round(views + d7.real * 4.3),
    cons: Math.round(views + d7.cons * 4.3),
  };

  const prob = (t) => {
    if (finalPotential.cons >= t) return Math.min(97, 80 + Math.min(17, (finalPotential.cons / t - 1) * 20));
    if (finalPotential.real >= t) return Math.min(68, 42 + Math.min(26, (finalPotential.real / t - 1) * 30));
    if (finalPotential.agg  >= t) return Math.min(38, 12 + Math.min(26, (finalPotential.agg  / t - 1) * 28));
    return Math.max(1, Math.round((finalPotential.agg / t) * 11));
  };

  const trend = days < 1 ? "Subindo" : days < 3 ? "Estável" : days < 7 ? "Desacelerando" : "Colapsando";

  return { current: Math.round(vph), trend, h24, h72, d7, finalPotential,
    reach100k: prob(100000), reach500k: prob(500000), reach1M: prob(1000000), reach10M: prob(10000000) };
}

function analyzeTitle(title) {
  if (!title) return { structure: "—", triggers: [], keywords: [] };
  const t = title;
  const lower = t.toLowerCase();

  let structure = "Declarativo";
  if (/\?/.test(t)) structure = "Pergunta";
  else if (/^\d+[\s_-]|(\b\d+\s*(dicas?|formas?|passos?|maneiras?|segredos?|jeitos?|razões?|tips?|ways?|steps?))/i.test(t)) structure = "Lista numerada";
  else if (/\bcomo\b|\bhow\s+to\b/i.test(t)) structure = "Tutorial / Como fazer";
  else if (/\bvs\.?\b|\bversus\b/i.test(t)) structure = "Comparação";
  else if (/\bpor\s+qu[eê]\b|\bwhy\b/i.test(t)) structure = "Por que (explicativo)";
  else if (/\breview\b|\bteste\b|\bavaliaç/i.test(t)) structure = "Review / Avaliação";

  const triggers = [];
  if (/\bsegred[oa]s?\b|\bexclusiv[oa]\b/i.test(t))           triggers.push("Exclusividade");
  if (/\bagora\b|\bjá\b|\bnão perd[ae]\b|\burgent\b/i.test(t))triggers.push("Urgência");
  if (/\bgrat[ui][st][ao]?\b|\bgr[áa]tis\b|\bfree\b/i.test(t))triggers.push("Gratuidade");
  if (/\bnovo\b|\bnova\b|\blan[çc]ament[oa]\b|\bnew\b/i.test(t)) triggers.push("Novidade");
  if (/\bnunc[ao]\b|\bimpossív[ae]l\b|\bnão\s+acreditei\b/i.test(t)) triggers.push("Incredulidade");
  if (/\bfácil\b|\bsimples\b|\brápid[oa]\b|\beasy\b|\bquick\b/i.test(t)) triggers.push("Facilidade");
  if (/\bdinheiro\b|\bmilhões?\b|\blucro\b|\brenda\b|\bganhei\b/i.test(t)) triggers.push("Ganho financeiro");
  if (/\bincr[ií]vel\b|\bchocant[ei]\b|\bsurpreend\b/i.test(t)) triggers.push("Surpresa/Choque");
  if (/\bvoc[eê]\b|\bseu\b|\bsua\b|\bprec[ia]s[ao]\b/i.test(t)) triggers.push("Personalização");
  if (/\berr[oaie]\b|\bfalh[aio]\b|\bnão\s+fa[cç][ao]\b/i.test(t)) triggers.push("Medo do erro");
  if (triggers.length === 0) triggers.push("Informativo");

  const words = lower
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  return { structure, triggers, keywords: [...new Set(words)].slice(0, 6) };
}

const COUNTRIES = [
  { code:"BR", flag:"🇧🇷", label:"Brasil" },    { code:"US", flag:"🇺🇸", label:"EUA" },
  { code:"PT", flag:"🇵🇹", label:"Portugal" },  { code:"MX", flag:"🇲🇽", label:"México" },
  { code:"AR", flag:"🇦🇷", label:"Argentina" }, { code:"CO", flag:"🇨🇴", label:"Colômbia" },
  { code:"CL", flag:"🇨🇱", label:"Chile" },     { code:"ES", flag:"🇪🇸", label:"Espanha" },
  { code:"GB", flag:"🇬🇧", label:"R. Unido" },  { code:"DE", flag:"🇩🇪", label:"Alemanha" },
  { code:"FR", flag:"🇫🇷", label:"França" },    { code:"IT", flag:"🇮🇹", label:"Itália" },
  { code:"CA", flag:"🇨🇦", label:"Canadá" },    { code:"AU", flag:"🇦🇺", label:"Austrália" },
  { code:"IN", flag:"🇮🇳", label:"Índia" },     { code:"JP", flag:"🇯🇵", label:"Japão" },
  { code:"PE", flag:"🇵🇪", label:"Peru" },      { code:"VE", flag:"🇻🇪", label:"Venezuela" },
];

const VIEW_PRESETS = [
  { label:"10K", value:"10000" }, { label:"50K", value:"50000" },
  { label:"100K", value:"100000" }, { label:"500K", value:"500000" }, { label:"1M", value:"1000000" },
];
const SUBS_PRESETS = [
  { label:"1K", value:"1000" }, { label:"5K", value:"5000" }, { label:"10K", value:"10000" },
  { label:"50K", value:"50000" }, { label:"100K", value:"100000" }, { label:"1M", value:"1000000" },
];
const MAX_VIEW_PRESETS = VIEW_PRESETS;
const MAX_SUBS_PRESETS = SUBS_PRESETS;

function SafeImg({ src, alt, style, fallbackName, fallbackSize = 42 }) {
  const [err, setErr] = useState(false);
  const [dark, light] = channelColor(fallbackName);
  if (!src || err) {
    return (
      <div style={{ ...style, background:light, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <span style={{ fontSize:(fallbackSize||42)*0.42, fontWeight:500, color:dark }}>
          {(fallbackName||"?").charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    <img src={src} alt={alt} referrerPolicy="no-referrer"
      onError={() => setErr(true)}
      style={{ ...style, objectFit:"cover", flexShrink:0 }}
    />
  );
}

// ─── Filtros ──────────────────────────────────────────────────────────────────
const FILTER_DEFS = {
  tipo: [
    { value:"video",    label:"Vídeos" },
    { value:"shorts",   label:"Shorts" },
    { value:"channel",  label:"Canais" },
    { value:"playlist", label:"Playlists" },
    { value:"movie",    label:"Filmes" },
  ],
  duracao: [
    { value:"short",  label:"Menos de 4 min" },
    { value:"medium", label:"De 4 a 20 min" },
    { value:"long",   label:"Mais de 20 min" },
  ],
  data: [
    { value:"today", label:"Hoje" },
    { value:"week",  label:"Esta semana" },
    { value:"month", label:"Este mês" },
    { value:"year",  label:"Este ano" },
  ],
  caracteristicas: [
    { value:"live",       label:"Ao vivo" },
    { value:"hd",         label:"Alta Definição" },
    { value:"cc",         label:"Legendas/CC" },
    { value:"cc_license", label:"Creative Commons" },
    { value:"3d",         label:"3D" },
  ],
  ordem: [
    { value:"relevance", label:"Relevância" },
    { value:"viewCount", label:"Popularidade" },
    { value:"date",      label:"Data" },
    { value:"rating",    label:"Avaliação" },
  ],
};

const DEFAULT_FILTERS = {
  tipo:"video", duracao:"", data:"", caracteristicas:[], ordem:"viewCount",
  minViews:"", maxViews:"", minSubs:"", maxSubs:"", country:"", channel:"",
};

async function resolveChannelId(apiKey, input) {
  const s = input.trim();
  if (!s) return null;
  // Already a channel ID
  if (/^UC[\w-]{22}$/.test(s)) return s;
  // URL containing /channel/UCxxxx
  const byId = s.match(/\/channel\/(UC[\w-]{22})/);
  if (byId) return byId[1];
  // @handle (URL or bare)
  const handle = s.match(/@([\w.-]+)/);
  if (handle) {
    const d = await ytFetch(apiKey, `/channels?part=id&forHandle=@${handle[1]}`);
    return d.items?.[0]?.id || null;
  }
  // /c/name or /user/name
  const custom = s.match(/\/(?:c|user)\/([\w.-]+)/);
  if (custom) {
    const d = await ytFetch(apiKey, `/channels?part=id&forUsername=${custom[1]}`);
    return d.items?.[0]?.id || null;
  }
  // Plain name — search and take first channel result
  const d = await ytFetch(apiKey, `/search?part=snippet&type=channel&q=${encodeURIComponent(s)}&maxResults=1`);
  return d.items?.[0]?.id?.channelId || null;
}

function FilterPanel({ filters, onChange, onClear }) {
  const videoOnly = ["video","movie"].includes(filters.tipo);
  const [countrySearch, setCountrySearch] = useState("");

  const activeCount = [
    filters.tipo !== "video" ? 1 : 0,
    filters.duracao ? 1 : 0,
    filters.data ? 1 : 0,
    filters.caracteristicas.length,
    filters.ordem !== "viewCount" ? 1 : 0,
    filters.minViews ? 1 : 0,
    filters.maxViews ? 1 : 0,
    filters.minSubs ? 1 : 0,
    filters.maxSubs ? 1 : 0,
    filters.country ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const chip = (key, val, label, multi = false) => {
    const active = multi ? filters.caracteristicas.includes(val) : filters[key] === val;
    return (
      <button key={val}
        onClick={() => {
          if (multi) {
            const next = active ? filters.caracteristicas.filter(v => v !== val) : [...filters.caracteristicas, val];
            onChange({ ...filters, caracteristicas: next });
          } else {
            const newVal = active ? (key === "tipo" ? "video" : key === "ordem" ? "viewCount" : "") : val;
            const updated = { ...filters, [key]: newVal };
            if (key === "tipo" && !["video", "movie", "shorts"].includes(newVal)) {
              updated.duracao = "";
              updated.data = "";
            }
            onChange(updated);
          }
        }}
        style={{ padding:"5px 14px", borderRadius:20, border:`1.5px solid ${active ? "#6366F1" : "var(--border)"}`, background:active ? "#6366F1" : "var(--surface)", color:active ? "#fff" : "var(--t2)", fontSize:12, fontWeight:active ? 600 : 400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s", whiteSpace:"nowrap" }}
      >{label}</button>
    );
  };

  const presetBtn = (filterKey, val, label) => {
    const active = filters[filterKey] === val;
    return (
      <button key={val}
        onClick={() => onChange({ ...filters, [filterKey]: active ? "" : val })}
        style={{ padding:"4px 12px", borderRadius:20, border:`1.5px solid ${active ? "#6366F1" : "var(--border)"}`, background:active ? "#EEF2FF" : "var(--surface)", color:active ? "#4F46E5" : "var(--t2)", fontSize:12, fontWeight:active ? 700 : 400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s", whiteSpace:"nowrap" }}
      >{label}</button>
    );
  };

  const lbl = { margin:"0 0 8px", fontSize:10, fontWeight:700, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.09em" };
  const sect = { display:"flex", flexDirection:"column" };
  const visibleCountries = countrySearch.trim()
    ? COUNTRIES.filter(c => c.label.toLowerCase().includes(countrySearch.toLowerCase()) || c.code.toLowerCase().includes(countrySearch.toLowerCase()))
    : COUNTRIES;
  const selectedCountry = COUNTRIES.find(c => c.code === filters.country);

  return (
    <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:16, padding:"22px 24px", marginBottom:16, boxShadow:"0 4px 12px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <span style={{ fontSize:13, fontWeight:700, color:"var(--t1)", letterSpacing:"-0.01em" }}>Filtros de pesquisa</span>
        {activeCount > 0 && (
          <button onClick={onClear} style={{ fontSize:12, color:"#EF4444", background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:20, cursor:"pointer", padding:"4px 12px", fontFamily:"inherit", fontWeight:600 }}>
            Limpar todos · {activeCount}
          </button>
        )}
      </div>

<div style={{ display:"flex", flexWrap:"wrap", gap:20, paddingBottom:20, borderBottom:"1px solid var(--border)", marginBottom:20 }}>
        <div style={sect}>
          <p style={lbl}>Tipo de conteúdo</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{FILTER_DEFS.tipo.map(f => chip("tipo", f.value, f.label))}</div>
        </div>
        {videoOnly && (
          <div style={sect}>
            <p style={lbl}>Duração</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{FILTER_DEFS.duracao.map(f => chip("duracao", f.value, f.label))}</div>
          </div>
        )}
        {videoOnly && (
          <div style={sect}>
            <p style={lbl}>Período</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{FILTER_DEFS.data.map(f => chip("data", f.value, f.label))}</div>
          </div>
        )}
        {videoOnly && (
          <div style={sect}>
            <p style={lbl}>Características</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{FILTER_DEFS.caracteristicas.map(f => chip("caracteristicas", f.value, f.label, true))}</div>
          </div>
        )}
        <div style={sect}>
          <p style={lbl}>Ordenar por</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{FILTER_DEFS.ordem.map(f => chip("ordem", f.value, f.label))}</div>
        </div>
      </div>

      <div style={{ display:"flex", flexWrap:"wrap", gap:28 }}>
        <div style={sect}>
          <p style={lbl}>Mínimo de views</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
            {VIEW_PRESETS.map(p => presetBtn("minViews", p.value, p.label))}
          </div>
          <input type="text"
            value={filters.minViews && !VIEW_PRESETS.find(p => p.value === filters.minViews) ? filters.minViews : ""}
            onChange={e => onChange({ ...filters, minViews: e.target.value })}
            placeholder="ou digite: ex 250000"
            style={{ width:180, padding:"6px 12px", border:"1.5px solid var(--border)", borderRadius:9, fontSize:12, color:"var(--t1)", background:"var(--surface)", outline:"none", fontFamily:"inherit" }}
          />
          {filters.minViews && (
            <p style={{ margin:"5px 0 0", fontSize:11, color:"#6366F1", fontWeight:600 }}>
              ≥ {Number(filters.minViews).toLocaleString("pt-BR")} views
              <button onClick={() => onChange({...filters, minViews:""})} style={{ marginLeft:6, color:"var(--t4)", background:"none", border:"none", cursor:"pointer", fontSize:11, padding:0 }}>✕</button>
            </p>
          )}
        </div>

        <div style={sect}>
          <p style={lbl}>Máximo de views</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
            {MAX_VIEW_PRESETS.map(p => presetBtn("maxViews", p.value, p.label))}
          </div>
          <input type="text"
            value={filters.maxViews && !MAX_VIEW_PRESETS.find(p => p.value === filters.maxViews) ? filters.maxViews : ""}
            onChange={e => onChange({ ...filters, maxViews: e.target.value })}
            placeholder="ou digite: ex 1000000"
            style={{ width:180, padding:"6px 12px", border:"1.5px solid var(--border)", borderRadius:9, fontSize:12, color:"var(--t1)", background:"var(--surface)", outline:"none", fontFamily:"inherit" }}
          />
          {filters.maxViews && (
            <p style={{ margin:"5px 0 0", fontSize:11, color:"#6366F1", fontWeight:600 }}>
              ≤ {Number(filters.maxViews).toLocaleString("pt-BR")} views
              <button onClick={() => onChange({...filters, maxViews:""})} style={{ marginLeft:6, color:"var(--t4)", background:"none", border:"none", cursor:"pointer", fontSize:11, padding:0 }}>✕</button>
            </p>
          )}
        </div>

        <div style={sect}>
          <p style={lbl}>Mínimo de inscritos</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
            {SUBS_PRESETS.map(p => presetBtn("minSubs", p.value, p.label))}
          </div>
          <input type="text"
            value={filters.minSubs && !SUBS_PRESETS.find(p => p.value === filters.minSubs) ? filters.minSubs : ""}
            onChange={e => onChange({ ...filters, minSubs: e.target.value })}
            placeholder="ou digite: ex 25000"
            style={{ width:180, padding:"6px 12px", border:"1.5px solid var(--border)", borderRadius:9, fontSize:12, color:"var(--t1)", background:"var(--surface)", outline:"none", fontFamily:"inherit" }}
          />
          {filters.minSubs && (
            <p style={{ margin:"5px 0 0", fontSize:11, color:"#6366F1", fontWeight:600 }}>
              ≥ {Number(filters.minSubs).toLocaleString("pt-BR")} inscritos
              <button onClick={() => onChange({...filters, minSubs:""})} style={{ marginLeft:6, color:"var(--t4)", background:"none", border:"none", cursor:"pointer", fontSize:11, padding:0 }}>✕</button>
            </p>
          )}
        </div>

        <div style={sect}>
          <p style={lbl}>Máximo de inscritos</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
            {MAX_SUBS_PRESETS.map(p => presetBtn("maxSubs", p.value, p.label))}
          </div>
          <input type="text"
            value={filters.maxSubs && !MAX_SUBS_PRESETS.find(p => p.value === filters.maxSubs) ? filters.maxSubs : ""}
            onChange={e => onChange({ ...filters, maxSubs: e.target.value })}
            placeholder="ou digite: ex 500000"
            style={{ width:180, padding:"6px 12px", border:"1.5px solid var(--border)", borderRadius:9, fontSize:12, color:"var(--t1)", background:"var(--surface)", outline:"none", fontFamily:"inherit" }}
          />
          {filters.maxSubs && (
            <p style={{ margin:"5px 0 0", fontSize:11, color:"#6366F1", fontWeight:600 }}>
              ≤ {Number(filters.maxSubs).toLocaleString("pt-BR")} inscritos
              <button onClick={() => onChange({...filters, maxSubs:""})} style={{ marginLeft:6, color:"var(--t4)", background:"none", border:"none", cursor:"pointer", fontSize:11, padding:0 }}>✕</button>
            </p>
          )}
        </div>

        <div style={sect}>
          <p style={lbl}>País / Região</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
            {visibleCountries.slice(0, 12).map(c => {
              const active = filters.country === c.code;
              return (
                <button key={c.code}
                  onClick={() => onChange({ ...filters, country: active ? "" : c.code })}
                  style={{ padding:"4px 11px", borderRadius:20, border:`1.5px solid ${active ? "#6366F1" : "var(--border)"}`, background:active ? "#6366F1" : "var(--surface)", color:active ? "#fff" : "var(--t2)", fontSize:12, fontWeight:active ? 600 : 400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s", display:"flex", alignItems:"center", gap:4, whiteSpace:"nowrap" }}
                >
                  {c.flag} {c.label}
                </button>
              );
            })}
          </div>
          <input type="text"
            value={countrySearch}
            onChange={e => setCountrySearch(e.target.value)}
            placeholder="Pesquisar país..."
            style={{ width:180, padding:"6px 12px", border:"1.5px solid var(--border)", borderRadius:9, fontSize:12, color:"var(--t1)", background:"var(--surface)", outline:"none", fontFamily:"inherit" }}
          />
          {selectedCountry && (
            <p style={{ margin:"5px 0 0", fontSize:11, color:"#6366F1", fontWeight:600 }}>
              {selectedCountry.flag} {selectedCountry.label} selecionado
              <button onClick={() => onChange({...filters, country:""})} style={{ marginLeft:6, color:"var(--t4)", background:"none", border:"none", cursor:"pointer", fontSize:11, padding:0 }}>✕ limpar</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Relatório viral ──────────────────────────────────────────────────────────
const COUNTRY_PATTERNS = [
  { key:"australia",   flag:"🇦🇺", label:"Australia",     patterns:["australia","australian","aussie","sydney","melbourne","brisbane"] },
  { key:"canada",      flag:"🇨🇦", label:"Canada",        patterns:["canada","canadian","toronto","vancouver","montreal"] },
  { key:"uk",          flag:"🇬🇧", label:"UK",            patterns:["uk","england","british","london","scotland","wales","united kingdom","manchester"] },
  { key:"usa",         flag:"🇺🇸", label:"USA",           patterns:["usa","america","american","united states","new york","los angeles","texas","florida"] },
  { key:"brazil",      flag:"🇧🇷", label:"Brasil",        patterns:["brazil","brasil","brasileiro","brasileira","são paulo","rio de janeiro"] },
  { key:"india",       flag:"🇮🇳", label:"India",         patterns:["india","indian","delhi","mumbai","bangalore","hyderabad"] },
  { key:"france",      flag:"🇫🇷", label:"France",        patterns:["france","french","paris","français","française","lyon"] },
  { key:"germany",     flag:"🇩🇪", label:"Alemanha",      patterns:["germany","german","deutsch","deutschland","berlin","munich","münchen"] },
  { key:"japan",       flag:"🇯🇵", label:"Japão",         patterns:["japan","japanese","tokyo","osaka","kyoto"] },
  { key:"mexico",      flag:"🇲🇽", label:"México",        patterns:["mexico","mexican","méxico","mexicano","mexicana","cdmx","guadalajara"] },
  { key:"italy",       flag:"🇮🇹", label:"Itália",        patterns:["italy","italian","italia","italiano","italiana","rome","milan"] },
  { key:"spain",       flag:"🇪🇸", label:"Espanha",       patterns:["spain","spanish","españa","español","española","madrid","barcelona"] },
  { key:"portugal",    flag:"🇵🇹", label:"Portugal",      patterns:["portugal","portuguese","português","portuguesa","lisboa","porto"] },
  { key:"south_africa",flag:"🇿🇦", label:"África do Sul", patterns:["south africa","south african","johannesburg","cape town"] },
  { key:"new_zealand", flag:"🇳🇿", label:"Nova Zelândia", patterns:["new zealand","auckland","wellington"] },
  { key:"netherlands", flag:"🇳🇱", label:"Holanda",       patterns:["netherlands","dutch","holland","amsterdam"] },
  { key:"south_korea", flag:"🇰🇷", label:"Coreia do Sul", patterns:["korea","korean","south korea","seoul"] },
  { key:"singapore",   flag:"🇸🇬", label:"Singapura",     patterns:["singapore","singaporean"] },
];

const CLONE_LANGS = [
  { lang:"es", label:"Espanhol", flag:"🇪🇸" },
  { lang:"fr", label:"Francês",  flag:"🇫🇷" },
  { lang:"de", label:"Alemão",   flag:"🇩🇪" },
  { lang:"ja", label:"Japonês",  flag:"🇯🇵" },
];

function ReportModal({ video, onClose, apiKey }) {
  const [tab, setTab] = useState("overview");
  const [cloneData, setCloneData]     = useState(null);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneError, setCloneError]   = useState(null);
  const signal    = trendSignal(video);
  const category  = classifyVideo(video);
  const proj      = projectVPH(video);
  const titleData = analyzeTitle(video.title);
  const daysOld   = (video.hoursOld || 0) / 24;

  const Tab = ({ id, label }) => (
    <button onClick={() => setTab(id)}
      style={{ padding:"7px 14px", borderRadius:20, border:"none", background:tab === id ? "#6366F1" : "transparent", color:tab === id ? "#fff" : "var(--t2)", fontSize:12, fontWeight:tab === id ? 700 : 500, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s", whiteSpace:"nowrap" }}
    >{label}</button>
  );

  const Row = ({ label, value, color }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"9px 0", borderBottom:"1px solid var(--border2)", gap:12 }}>
      <span style={{ fontSize:12, color:"var(--t3)", fontWeight:500, flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:12, color:color || "var(--t1)", fontWeight:600, textAlign:"right" }}>{value}</span>
    </div>
  );

  const Sect = ({ title, children }) => (
    <div style={{ marginBottom:22 }}>
      <p style={{ margin:"0 0 12px", fontSize:10, fontWeight:700, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.09em" }}>{title}</p>
      {children}
    </div>
  );

  const ScenarioCard = ({ label, value, color }) => (
    <div style={{ textAlign:"center", background:"var(--surface2)", borderRadius:10, padding:"12px 8px" }}>
      <div style={{ fontSize:11, color:"var(--t3)", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:800, color }}>{value}</div>
    </div>
  );

  const CloneCard = ({ item }) => (
    <a href={item.url} target="_blank" rel="noreferrer"
      style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 10px", background:"var(--surface2)", borderRadius:10, textDecoration:"none", border:"1px solid var(--border)" }}>
      {item.thumbnail && (
        <img src={item.thumbnail} alt="" style={{ width:104, height:58, objectFit:"cover", borderRadius:6, flexShrink:0 }} />
      )}
      <div style={{ minWidth:0 }}>
        <p style={{ margin:"0 0 3px", fontSize:12, fontWeight:600, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", lineHeight:1.35 }}>{item.title}</p>
        <p style={{ margin:0, fontSize:11, color:"var(--t3)" }}>{item.channel}</p>
      </div>
    </a>
  );

  const fetchClones = async () => {
    if (cloneLoading || cloneData) return;
    setCloneLoading(true);
    setCloneError(null);
    try {
      const kws = titleData.keywords?.slice(0, 5) || [];
      const topic = kws.length >= 2 ? kws.join(" ") : video.title.split(" ").slice(0, 4).join(" ");

      // Section 1: Country clones — 1 search call (~100 quota units)
      const countrySearch = await ytFetch(apiKey,
        `/search?part=snippet&q=${encodeURIComponent(topic)}&type=video&maxResults=50&order=viewCount`
      );
      const countryGroups = {};
      for (const item of (countrySearch.items || [])) {
        if (item.snippet.channelId === video.channelId) continue;
        const combined = ((item.snippet.title || "") + " " + (item.snippet.description || "")).toLowerCase();
        for (const cp of COUNTRY_PATTERNS) {
          if (cp.patterns.some(p => combined.includes(p))) {
            if (!countryGroups[cp.key]) countryGroups[cp.key] = { ...cp, items: [] };
            if (countryGroups[cp.key].items.length < 3) {
              countryGroups[cp.key].items.push({
                videoId: item.id.videoId,
                title: item.snippet.title,
                channel: item.snippet.channelTitle,
                thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
                url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
              });
            }
            break;
          }
        }
      }

      // Section 2: Language clones — 1 search per language (~100 quota units each)
      const langGroups = {};
      for (const target of CLONE_LANGS) {
        const translated = await translateQuery(topic, target.lang, "pt");
        const isNew = translated && translated.toLowerCase() !== topic.toLowerCase();
        const q = isNew ? translated : topic;
        const data = await ytFetch(apiKey,
          `/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=12&relevanceLanguage=${target.lang}&order=viewCount`
        );
        langGroups[target.lang] = {
          ...target,
          translatedTopic: isNew ? translated : null,
          items: (data.items || [])
            .filter(i => i.snippet.channelId !== video.channelId)
            .slice(0, 5)
            .map(i => ({
              videoId: i.id.videoId,
              title: i.snippet.title,
              channel: i.snippet.channelTitle,
              thumbnail: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url || "",
              url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
            })),
        };
      }

      setCloneData({ topic, countryGroups, langGroups });
    } catch (e) {
      setCloneError(e.message);
    } finally {
      setCloneLoading(false);
    }
  };

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width:"100%", maxWidth:860, maxHeight:"93vh", display:"flex", flexDirection:"column", background:"var(--surface)", borderRadius:24 }}>

        {/* Header sticky */}
        <div style={{ padding:"20px 24px 0", borderBottom:"1px solid var(--border)", position:"sticky", top:0, background:"var(--surface)", zIndex:10, borderRadius:"24px 24px 0 0", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:12 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                <span style={{ fontSize:11, fontWeight:800, padding:"3px 10px", borderRadius:20, background:signal.bg, color:signal.textColor, border:`1px solid ${signal.border}` }}>
                  {signal.dot} {signal.label}
                </span>
                <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"#EEF2FF", color:"#4F46E5", border:"1px solid #C7D2FE" }}>
                  {category}
                </span>
              </div>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:"var(--t1)", lineHeight:1.4 }}>{video.title}</p>
              <p style={{ margin:"4px 0 0", fontSize:12, color:"var(--t3)" }}>
                {video.channel} · {formatAge(video.hoursOld)} · {formatViews(video.viewsRaw)} views
                {video.durationStr && video.durationStr !== "—" ? ` · ${video.durationStr}` : ""}
              </p>
            </div>
            <button onClick={onClose}
              style={{ width:32, height:32, borderRadius:8, background:"var(--border2)", border:"none", cursor:"pointer", color:"var(--t2)", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>✕</button>
          </div>
          <div style={{ display:"flex", gap:4, overflowX:"auto", paddingBottom:14 }}>
            <Tab id="overview"   label="📊 Visão Geral" />
            <Tab id="projection" label="📈 Projeção VPH" />
            <Tab id="content"    label="🎯 Conteúdo" />
            <Tab id="strategy"   label="🚀 Estratégia" />
            <Tab id="clones"     label="🌍 Clones" />
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ padding:"20px 24px", overflowY:"auto", flex:1 }}>

          {tab === "overview" && (
            <>
              {/* KPI grid */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(130px, 1fr))", gap:10, marginBottom:22 }}>
                {[
                  { icon:"👁", label:"Views", value:formatViews(video.viewsRaw) },
                  { icon:"⚡", label:"VPH", value:formatVPH(video.vph || 0) },
                  { icon:"📊", label:"Outlier", value:`${(video.outlier||0).toFixed(1)}x` },
                  { icon:"👍", label:"Curtidas", value:video.likesRaw > 0 ? formatViews(video.likesRaw) : "—" },
                  { icon:"💬", label:"Comentários", value:video.commentsRaw > 0 ? formatViews(video.commentsRaw) : "—" },
                  { icon:"⏱",  label:"Duração", value:video.durationStr || "—" },
                  { icon:"👥", label:"Inscritos", value:video.channelSubscribers > 0 ? formatViews(video.channelSubscribers) : "—" },
                  { icon:"📅", label:"Publicado", value:formatAge(video.hoursOld) },
                ].map((m, i) => (
                  <div key={i} style={{ background:"var(--surface2)", borderRadius:12, padding:"12px", textAlign:"center" }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{m.icon}</div>
                    <div style={{ fontSize:14, fontWeight:800, color:"var(--t1)" }}>{m.value}</div>
                    <div style={{ fontSize:10, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.05em" }}>{m.label}</div>
                  </div>
                ))}
              </div>

              <Sect title="Trend Signal">
                <div style={{ padding:"14px 18px", borderRadius:12, background:signal.bg, border:`2px solid ${signal.border}` }}>
                  <p style={{ margin:"0 0 6px", fontSize:15, fontWeight:800, color:signal.textColor }}>{signal.dot} {signal.label}</p>
                  <p style={{ margin:0, fontSize:12, color:signal.textColor, opacity:0.85, lineHeight:1.6 }}>
                    {daysOld < 1 ? "Vídeo com menos de 24h de vida." : `Publicado há ${formatAge(video.hoursOld)}.`}
                    {(video.outlier||0) >= 5 ? " Performance explosiva — muito acima da média do canal." :
                     (video.outlier||0) >= 2 ? " Crescimento acima da média do canal." :
                     " Crescimento dentro ou abaixo da média do canal."}
                  </p>
                </div>
              </Sect>

              <Sect title="Métricas de Performance">
                <div style={{ borderRadius:12, border:"1px solid var(--border)", padding:"0 14px" }}>
                  <Row label="VPH (Views por Hora)" value={`${formatVPH(video.vph||0)} views/h`} />
                  <Row label="Outlier Score (vs. média do canal)" value={`${(video.outlier||0).toFixed(2)}x`}
                    color={(video.outlier||0) >= 5 ? "#DC2626" : (video.outlier||0) >= 2 ? "#059669" : (video.outlier||0) >= 1 ? "#2563EB" : "#6B7280"} />
                  <Row label="Velocidade de crescimento"
                    value={(video.outlier||0) >= 5 ? "Explosivo 🔥" : (video.outlier||0) >= 2 ? "Muito rápido ⬆" : (video.outlier||0) >= 1 ? "Acima da média ↑" : "Normal →"} />
                  <Row label="Potencial de viralização"
                    value={(video.outlier||0) >= 5 ? "Muito alto" : (video.outlier||0) >= 2 ? "Alto" : (video.outlier||0) >= 1 ? "Médio" : "Baixo"} />
                  <Row label="Probabilidade de continuar crescendo"
                    value={daysOld < 1 ? "Alta" : daysOld < 3 ? "Média-Alta" : daysOld < 7 ? "Média" : "Baixa"} />
                  <Row label="Potencial de replicação do tema"
                    value={(video.outlier||0) >= 3 ? "Alto — tema comprovado" : (video.outlier||0) >= 1.5 ? "Médio — vale testar" : "Baixo"} />
                  <Row label="Autoridade do canal"
                    value={(video.channelSubscribers||0) >= 500000 ? "Alta (canal grande)" : (video.channelSubscribers||0) >= 50000 ? "Média" : (video.channelSubscribers||0) >= 5000 ? "Em crescimento" : "Canal pequeno/novo"} />
                </div>
              </Sect>
            </>
          )}

          {tab === "projection" && (
            <>
              <Sect title="VPH Atual e Tendência">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:4 }}>
                  <div style={{ background:"var(--surface2)", borderRadius:12, padding:"16px", textAlign:"center" }}>
                    <div style={{ fontSize:30, fontWeight:900, color:"#6366F1", lineHeight:1 }}>{formatVPH(proj.current)}</div>
                    <div style={{ fontSize:11, color:"var(--t4)", marginTop:4 }}>views/hora atual</div>
                  </div>
                  <div style={{ background:"var(--surface2)", borderRadius:12, padding:"16px", textAlign:"center" }}>
                    <div style={{ fontSize:20, fontWeight:800, lineHeight:1,
                      color: proj.trend === "Subindo" ? "#059669" : proj.trend === "Estável" ? "#2563EB" : proj.trend === "Desacelerando" ? "#D97706" : "#DC2626"
                    }}>{proj.trend}</div>
                    <div style={{ fontSize:11, color:"var(--t4)", marginTop:4 }}>tendência do VPH</div>
                  </div>
                </div>
              </Sect>

              <Sect title="Projeção de Views Adicionais">
                {[
                  { period:"Próximas 24h",     d:proj.h24 },
                  { period:"Próximas 72h",     d:proj.h72 },
                  { period:"Próximos 7 dias",  d:proj.d7  },
                ].map(({ period, d }) => (
                  <div key={period} style={{ marginBottom:12, borderRadius:12, border:"1px solid var(--border)", padding:"14px" }}>
                    <p style={{ margin:"0 0 10px", fontSize:12, fontWeight:700, color:"var(--t1)" }}>{period}</p>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                      <ScenarioCard label="🟢 Agressivo"   value={`+${formatViews(d.agg)}`}  color="#059669" />
                      <ScenarioCard label="🟡 Realista"    value={`+${formatViews(d.real)}`} color="#D97706" />
                      <ScenarioCard label="🔴 Conservador" value={`+${formatViews(d.cons)}`} color="#DC2626" />
                    </div>
                  </div>
                ))}
              </Sect>

              <Sect title="Potencial Final (estimativa 30 dias)">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:20 }}>
                  <ScenarioCard label="🟢 Agressivo"   value={formatViews(proj.finalPotential.agg)}  color="#059669" />
                  <ScenarioCard label="🟡 Realista"    value={formatViews(proj.finalPotential.real)} color="#D97706" />
                  <ScenarioCard label="🔴 Conservador" value={formatViews(proj.finalPotential.cons)} color="#DC2626" />
                </div>
              </Sect>

              <Sect title="Probabilidade de Atingir Marcos">
                {[
                  { label:"100K views", prob:proj.reach100k },
                  { label:"500K views", prob:proj.reach500k },
                  { label:"1M+ views",  prob:proj.reach1M   },
                  { label:"10M+ views", prob:proj.reach10M  },
                ].map(({ label, prob }) => (
                  <div key={label} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                      <span style={{ fontSize:12, color:"var(--t2)", fontWeight:600 }}>{label}</span>
                      <span style={{ fontSize:12, fontWeight:800, color:prob >= 60 ? "#059669" : prob >= 30 ? "#D97706" : "#DC2626" }}>{prob}%</span>
                    </div>
                    <div style={{ height:7, background:"var(--border)", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${prob}%`, borderRadius:4, transition:"width 0.6s ease",
                        background:prob >= 60 ? "#10B981" : prob >= 30 ? "#F59E0B" : "#EF4444" }} />
                    </div>
                  </div>
                ))}
              </Sect>
            </>
          )}

          {tab === "content" && (
            <>
              <Sect title="Análise do Título">
                <div style={{ borderRadius:12, border:"1px solid var(--border)", padding:"0 14px" }}>
                  <Row label="Estrutura"           value={titleData.structure} />
                  <Row label="Palavras-chave"       value={titleData.keywords.join(", ") || "—"} />
                  <Row label="Gatilhos emocionais"  value={titleData.triggers.join(" · ")} />
                </div>
              </Sect>

              <Sect title="Análise do Vídeo">
                <div style={{ borderRadius:12, border:"1px solid var(--border)", padding:"0 14px" }}>
                  <Row label="Duração" value={video.durationStr || "—"} />
                  <Row label="Formato estimado"
                    value={!video.durationSec ? "—" :
                      video.durationSec < 60   ? "Short (< 1 min)" :
                      video.durationSec < 240  ? "Vídeo curto (1–4 min)" :
                      video.durationSec < 1200 ? "Vídeo médio (4–20 min)" :
                      "Vídeo longo (20+ min)"} />
                  <Row label="Tipo de thumbnail" value="Análise visual não disponível via API" />
                  <Row label="Crescimento parece"
                    value={(video.outlier||0) >= 3 ? "Orgânico + Algoritmo" : (video.outlier||0) >= 1.5 ? "Orgânico" : "Misto / Incerto"} />
                  <Row label="Tema cedo ou tarde?"
                    value={daysOld < 2 ? "Cedo — excelente timing!" : daysOld < 5 ? "No pico — ainda válido" : daysOld < 10 ? "Ligeiramente tarde" : "Tarde — tema envelheceu"} />
                  <Row label="Depende de thumbnail?" value={(video.durationSec||0) < 60 ? "Muito (Short)" : "Moderadamente"} />
                  <Row label="Depende do tema?"
                    value={(video.outlier||0) >= 3 ? "Sim — tema é o diferencial" : "Parcialmente"} />
                </div>
              </Sect>

              <Sect title="Público-alvo Estimado">
                <div style={{ background:"var(--surface2)", borderRadius:12, padding:"14px", fontSize:13, color:"var(--t2)", lineHeight:1.7 }}>
                  Canal com {video.channelSubscribers > 0 ? formatViews(video.channelSubscribers) : "?"} inscritos —&nbsp;
                  {(video.channelSubscribers||0) >= 500000 ? "grande audiência consolidada" :
                   (video.channelSubscribers||0) >= 50000  ? "audiência estabelecida em crescimento" :
                   (video.channelSubscribers||0) >= 5000   ? "canal em crescimento com nicho definido" :
                   "canal pequeno com potencial emergente"}.
                  Tema: <strong style={{ color:"var(--t1)" }}>{titleData.keywords.slice(0,3).join(", ") || "N/A"}</strong>.
                </div>
              </Sect>
            </>
          )}

          {tab === "strategy" && (
            <>
              <Sect title="Avaliação Estratégica">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:4 }}>
                  {[
                    { label:"Momento para entrar",
                      value: daysOld < 2 ? "Agora! ✅" : daysOld < 5 ? "Ainda válido ⚠" : "Tarde ❌",
                      color: daysOld < 2 ? "#059669" : daysOld < 5 ? "#D97706" : "#DC2626" },
                    { label:"Potencial de replicação",
                      value: (video.outlier||0) >= 3 ? "Alto 🔥" : (video.outlier||0) >= 1.5 ? "Médio" : "Baixo",
                      color: (video.outlier||0) >= 3 ? "#DC2626" : (video.outlier||0) >= 1.5 ? "#D97706" : "#6B7280" },
                    { label:"Canal tem autoridade no tema",
                      value: (video.channelSubscribers||0) >= 100000 ? "Sim ✓" : "Em construção",
                      color: "var(--t1)" },
                    { label:"Janela viral",
                      value: daysOld < 1 ? "Aberta 🔓" : daysOld < 3 ? "Se fechando" : "Fechada 🔒",
                      color: daysOld < 1 ? "#059669" : daysOld < 3 ? "#D97706" : "#DC2626" },
                  ].map(m => (
                    <div key={m.label} style={{ background:"var(--surface2)", borderRadius:12, padding:"12px 14px" }}>
                      <p style={{ margin:"0 0 4px", fontSize:10, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{m.label}</p>
                      <p style={{ margin:0, fontSize:14, fontWeight:700, color:m.color }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              </Sect>

              <Sect title="Por que este vídeo está performando?">
                <div style={{ background:"var(--surface2)", borderRadius:12, padding:"14px 18px" }}>
                  <ul style={{ margin:0, paddingLeft:18, fontSize:13, color:"var(--t2)", lineHeight:2.1 }}>
                    {(video.outlier||0) >= 5 && <li>Outlier score explosivo ({(video.outlier||0).toFixed(1)}x) — algoritmo está distribuindo ativamente</li>}
                    {(video.outlier||0) >= 2 && (video.outlier||0) < 5 && <li>Performance significativamente acima da média do canal ({(video.outlier||0).toFixed(1)}x)</li>}
                    {(video.vph||0) > 1000 && <li>VPH muito alto ({formatVPH(video.vph||0)}) — sinal forte de distribuição orgânica</li>}
                    {(video.vph||0) > 100 && (video.vph||0) <= 1000 && <li>VPH sólido ({formatVPH(video.vph||0)}) — crescimento consistente</li>}
                    {titleData.triggers.length > 1 && <li>Múltiplos gatilhos emocionais no título: <em>{titleData.triggers.join(", ")}</em></li>}
                    {titleData.structure !== "Declarativo" && <li>Estrutura de título eficiente: <em>{titleData.structure}</em></li>}
                    {daysOld < 1 && <li>Vídeo novo — dentro da janela máxima de distribuição do algoritmo</li>}
                    {(video.channelSubscribers||0) < 10000 && (video.outlier||0) >= 2 && <li>Canal pequeno com crescimento anormal — possível descoberta emergente</li>}
                    <li>Tema com demanda ativa comprovada pelas métricas</li>
                  </ul>
                </div>
              </Sect>

              <Sect title="Elementos para Replicar">
                <div style={{ borderRadius:12, border:"1px solid var(--border)", padding:"0 14px" }}>
                  <Row label="Estrutura de título"    value={titleData.structure} />
                  <Row label="Palavras-chave do título" value={titleData.keywords.slice(0,4).join(", ") || "—"} />
                  <Row label="Gatilho principal"      value={titleData.triggers[0] || "—"} />
                  <Row label="Duração similar"        value={video.durationStr || "—"} />
                  <Row label="Risco de saturação"
                    value={daysOld > 7 ? "Alto — tema já circulando" : daysOld > 3 ? "Médio" : "Baixo — janela aberta"}
                    color={daysOld > 7 ? "#DC2626" : daysOld > 3 ? "#D97706" : "#059669"} />
                </div>
              </Sect>
            </>
          )}

          {tab === "clones" && (
            <>
              {!cloneData && !cloneLoading && (
                <div style={{ textAlign:"center", padding:"3rem 1rem" }}>
                  <p style={{ fontSize:36, margin:"0 0 10px" }}>🌍</p>
                  <p style={{ margin:"0 0 6px", fontSize:15, fontWeight:700, color:"var(--t1)" }}>Clones Internacionais</p>
                  <p style={{ margin:"0 0 6px", fontSize:13, color:"var(--t3)", maxWidth:380, marginInline:"auto", lineHeight:1.6 }}>
                    Detecta vídeos com o mesmo conceito publicados em outros países (padrão <em>In Australia</em>, <em>In Canada</em>…) e versões traduzidas para outros idiomas.
                  </p>
                  <p style={{ margin:"0 0 22px", fontSize:11, color:"var(--t4)" }}>~500 unidades de quota · carregamento único</p>
                  <button onClick={fetchClones}
                    style={{ padding:"10px 28px", borderRadius:20, border:"none", background:"linear-gradient(135deg,#6366F1,#4F46E5)", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 12px rgba(99,102,241,0.35)" }}>
                    🔍 Buscar Clones
                  </button>
                  {cloneError && <p style={{ marginTop:14, fontSize:12, color:"#EF4444" }}>Erro: {cloneError}</p>}
                </div>
              )}

              {cloneLoading && (
                <div style={{ textAlign:"center", padding:"3rem 0" }}>
                  <p style={{ fontSize:28, margin:"0 0 10px" }}>⏳</p>
                  <p style={{ fontSize:13, color:"var(--t3)" }}>Buscando clones internacionais…</p>
                </div>
              )}

              {cloneData && (
                <>
                  <Sect title={`📍 Clones por País · tema: "${cloneData.topic}"`}>
                    {Object.keys(cloneData.countryGroups).length === 0 ? (
                      <p style={{ fontSize:13, color:"var(--t4)", padding:"10px 0" }}>Nenhum clone por país detectado nos resultados da busca.</p>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
                        {Object.values(cloneData.countryGroups).map(cg => (
                          <div key={cg.key}>
                            <p style={{ margin:"0 0 8px", fontSize:13, fontWeight:700, color:"var(--t1)" }}>
                              {cg.flag} {cg.label}
                            </p>
                            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                              {cg.items.map(item => <CloneCard key={item.videoId} item={item} />)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Sect>

                  <Sect title="🌐 Clones por Idioma">
                    <div style={{ display:"flex", flexDirection:"column", gap:22 }}>
                      {Object.values(cloneData.langGroups).map(lg => (
                        <div key={lg.lang}>
                          <p style={{ margin:"0 0 8px", fontSize:13, fontWeight:700, color:"var(--t1)", display:"flex", alignItems:"center", gap:6 }}>
                            {lg.flag} {lg.label}
                            {lg.translatedTopic && (
                              <span style={{ fontSize:12, fontWeight:400, color:"var(--t3)" }}>— &ldquo;{lg.translatedTopic}&rdquo;</span>
                            )}
                          </p>
                          {lg.items.length === 0 ? (
                            <p style={{ fontSize:12, color:"var(--t4)", margin:0 }}>Sem resultados encontrados.</p>
                          ) : (
                            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                              {lg.items.map(item => <CloneCard key={item.videoId} item={item} />)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Sect>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"14px 24px", borderTop:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <span style={{ fontSize:11, color:"var(--t4)" }}>Relatório gerado com base em dados da YouTube API</span>
          <a href={video.url} target="_blank" rel="noreferrer"
            style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 18px", background:"linear-gradient(135deg,#6366F1,#4F46E5)", color:"#fff", borderRadius:20, textDecoration:"none", fontSize:13, fontWeight:600, boxShadow:"0 4px 12px rgba(99,102,241,0.35)" }}>
            ▶ Abrir no YouTube
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────────────
function VideoCard({ video, rank, index, onChannelClick, onReportClick, onFollowToggle, isFollowed }) {
  const [dark] = channelColor(video.channel);
  const chUrl = video.channelUrl || `https://www.youtube.com/channel/${video.channelId}`;
  const ob     = video.outlier > 0 ? outlierBadge(video.outlier) : null;
  const signal = trendSignal(video);
  const opp    = video.type === "video" ? calcOpportunityScore(video) : null;
  const isTop3 = rank <= 3;

  return (
    <div
      className="video-card"
      style={{ background:"var(--surface)", border:`1px solid ${isTop3 ? "#A5B4FC" : "var(--border)"}`, borderRadius:16, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:isTop3 ? "0 4px 12px rgba(99,102,241,0.12)" : "0 1px 4px rgba(0,0,0,0.05)", transition:"transform 0.18s, box-shadow 0.18s", animationDelay:`${index*35}ms`, animation:"fadeUp 0.35s ease both" }}
      onMouseEnter={e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 12px 28px rgba(0,0,0,0.1)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow=isTop3?"0 4px 12px rgba(99,102,241,0.12)":"0 1px 4px rgba(0,0,0,0.05)"; }}
    >
      <a href={video.url} target="_blank" rel="noreferrer" style={{ display:"block", textDecoration:"none" }}>
        <div style={{ width:"100%", aspectRatio:"16/9", background:dark, position:"relative", overflow:"hidden" }}>
          <SafeImg src={video.thumbnail} alt={video.title} fallbackName={video.channel} style={{ width:"100%", height:"100%", borderRadius:0 }} />
          <div style={{ position:"absolute", top:8, left:8, background:isTop3?"linear-gradient(135deg,#6366F1,#4F46E5)":"rgba(0,0,0,0.6)", color:"#fff", fontSize:11, fontWeight:800, padding:"3px 9px", borderRadius:20, backdropFilter:"blur(4px)" }}>#{rank}</div>
          {video.views !== "—" && (
            <div style={{ position:"absolute", bottom:8, right:8, background:"rgba(0,0,0,0.75)", color:"#fff", fontSize:11, fontWeight:500, padding:"3px 8px", borderRadius:8 }}>{video.views}</div>
          )}
          {ob && video.outlier >= 2 && (
            <div style={{ position:"absolute", top:8, right:8, background:ob.bg, color:ob.text, fontSize:10, fontWeight:800, padding:"3px 10px", borderRadius:20 }}>{ob.label}</div>
          )}
          {opp && opp.score >= 50 && (
            <div style={{ position:"absolute", bottom:8, left:8, background:"rgba(0,0,0,0.72)", color:"#fff", fontSize:10, fontWeight:800, padding:"3px 9px", borderRadius:20, backdropFilter:"blur(4px)", display:"flex", alignItems:"center", gap:4 }}>
              <span>{opp.emoji}</span>
              <span style={{ color:opp.color }}>{opp.label.toUpperCase()}</span>
              <span style={{ color:"#94A3B8", fontSize:9 }}>{opp.score}</span>
            </div>
          )}
        </div>
      </a>

      <div style={{ padding:"16px 16px 18px", flex:1, display:"flex", flexDirection:"column", gap:10 }}>
        <a href={video.url} target="_blank" rel="noreferrer" style={{ textDecoration:"none" }}>
          <p style={{ margin:0, fontSize:14, fontWeight:600, color:"var(--t1)", lineHeight:1.5, display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden", letterSpacing:"-0.01em" }}>
            {video.title}
          </p>
        </a>

        {/* Trend signal + age */}
        {video.type === "video" && (
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20, background:signal.bg, color:signal.textColor, border:`1px solid ${signal.border}`, whiteSpace:"nowrap" }}>
              {signal.dot} {signal.label}
            </span>
            <span style={{ fontSize:11, color:"var(--t4)" }}>{formatAge(video.hoursOld)}</span>
          </div>
        )}

        {video.type === "video" && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, alignItems:"center" }}>
            {opp && (
              <div style={{ display:"flex", alignItems:"center", gap:4, background:opp.bg, border:`1px solid ${opp.border}`, padding:"3px 9px", borderRadius:20 }}
                title={`Índice de Oportunidade: ${opp.score}/100`}>
                <span style={{ fontSize:11 }}>{opp.emoji}</span>
                <span style={{ fontSize:11, color:opp.color, fontWeight:800 }}>{opp.label}</span>
                <span style={{ fontSize:10, color:opp.color, opacity:0.7 }}>{opp.score}</span>
              </div>
            )}
            {video.vph > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:4, background:"#F0FDF4", border:"1px solid #86EFAC", padding:"3px 9px", borderRadius:20 }}>
                <span style={{ fontSize:10, color:"#15803D", fontWeight:700 }}>VPH</span>
                <span style={{ fontSize:12, color:"#166534", fontWeight:700 }}>{formatVPH(video.vph)}</span>
              </div>
            )}
            {ob && (
              <div style={{ background:ob.bg, color:ob.text, padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}
                title={`${video.outlier.toFixed(1)}x acima da média do canal`}>
                {ob.label}
              </div>
            )}
            {video.channelSubscribers > 0 && (
              <span style={{ fontSize:11, color:"var(--t3)" }}>{formatViews(video.channelSubscribers)} inscritos</span>
            )}
          </div>
        )}

        <div style={{ display:"flex", alignItems:"center", gap:7, marginTop:"auto", paddingTop:8, borderTop:"1px solid var(--border2)" }}>
          <a href={chUrl} target="_blank" rel="noreferrer" style={{ display:"flex", flexShrink:0 }}>
            <SafeImg src={video.channelThumbnail} alt={video.channel} fallbackName={video.channel} fallbackSize={24} style={{ width:24, height:24, borderRadius:"50%" }} />
          </a>
          <a href={chUrl} target="_blank" rel="noreferrer"
            style={{ fontSize:12, color:"#6366F1", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration:"none", fontWeight:600 }}
            onClick={e => e.stopPropagation()}>
            {video.channel}
          </a>
          {video.durationStr && video.durationStr !== "—" && (
            <span style={{ fontSize:10, color:"var(--t4)", background:"var(--surface2)", padding:"2px 6px", borderRadius:6, flexShrink:0 }}>{video.durationStr}</span>
          )}
        </div>

        {video.type === "video" && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {onFollowToggle && (
              <button
                onClick={() => onFollowToggle(video.channelId, video.channel, video.channelThumbnail, video.channelSubscribers)}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600, color: isFollowed ? "#7C3AED" : "var(--t2)", background: isFollowed ? "#EDE9FE" : "var(--surface2)", border: `1px solid ${isFollowed ? "#C4B5FD" : "var(--border)"}`, borderRadius:20, padding:"5px 11px", cursor:"pointer", width:"fit-content", fontFamily:"inherit", transition:"all 0.15s" }}
              >
                {isFollowed ? "✓ Seguindo" : "+ Seguir"}
              </button>
            )}
            {onChannelClick && (
              <button
                onClick={() => onChannelClick(video.channel, video.channelId)}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600, color:"#4F46E5", background:"#EEF2FF", border:"1px solid #C7D2FE", borderRadius:20, padding:"5px 11px", cursor:"pointer", width:"fit-content", fontFamily:"inherit", transition:"background 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background="#E0E7FF"; }}
                onMouseLeave={e => { e.currentTarget.style.background="#EEF2FF"; }}
              >
                🔍 Canais similares
              </button>
            )}
            {onReportClick && (
              <button
                onClick={() => onReportClick(video)}
                style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600, color:"#059669", background:"#F0FDF4", border:"1px solid #86EFAC", borderRadius:20, padding:"5px 11px", cursor:"pointer", width:"fit-content", fontFamily:"inherit", transition:"background 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background="#DCFCE7"; }}
                onMouseLeave={e => { e.currentTarget.style.background="#F0FDF4"; }}
              >
                📊 Relatório
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SimilarChannelCard({ ch, index }) {
  const score     = ch.similarityScore || 0;
  const scoreText = score >= 70 ? "#064E3B" : score >= 40 ? "#78350F" : "#7F1D1D";
  const barColor  = score >= 70 ? "#10B981" : score >= 40 ? "#F59E0B" : "#EF4444";

  return (
    <a href={ch.url} target="_blank" rel="noreferrer"
      style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:14, padding:"16px", display:"flex", flexDirection:"column", gap:10, textDecoration:"none", boxShadow:"0 1px 4px rgba(0,0,0,0.04)", transition:"all 0.18s", animationDelay:`${index*40}ms`, animation:"fadeUp 0.3s ease both" }}
      onMouseEnter={e => { e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 8px 20px rgba(0,0,0,0.09)"; e.currentTarget.style.borderColor="#A5B4FC"; }}
      onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor="var(--border)"; }}
    >
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <SafeImg src={ch.thumbnail} alt={ch.name} fallbackName={ch.name} fallbackSize={44} style={{ width:44, height:44, borderRadius:12 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ margin:0, fontSize:13, fontWeight:700, color:"var(--t1)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", letterSpacing:"-0.01em" }}>{ch.name}</p>
          <div style={{ display:"flex", gap:10, marginTop:3 }}>
            {ch.subscribers !== "—" && <span style={{ fontSize:11, color:"var(--t3)" }}>👥 {ch.subscribers}</span>}
            {ch.totalVideos !== "—" && <span style={{ fontSize:11, color:"var(--t3)" }}>🎬 {ch.totalVideos}</span>}
          </div>
        </div>
        <div style={{ textAlign:"center", flexShrink:0, background:"var(--surface2)", borderRadius:10, padding:"6px 10px" }}>
          <div style={{ fontSize:17, fontWeight:800, color:scoreText, lineHeight:1 }}>{score}%</div>
          <div style={{ fontSize:9, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.06em", marginTop:2 }}>similar</div>
        </div>
      </div>
      <div style={{ height:5, background:"var(--border)", borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${score}%`, background:barColor, borderRadius:3 }} />
      </div>
      {ch.description && (
        <p style={{ margin:0, fontSize:12, color:"var(--t3)", lineHeight:1.55, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{ch.description}</p>
      )}
      <div style={{ fontSize:12, color:"#6366F1", fontWeight:600 }}>↗ Abrir canal no YouTube</div>
    </a>
  );
}

function SimilarPanel({ channelName, channelId, apiKey, onClose }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true); setResult(null); setError(null);
    searchSimilarChannels(apiKey, channelId)
      .then(setResult)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey, channelId, channelName]);

  return (
    <div style={{ border:"1px solid #A5B4FC", borderRadius:18, overflow:"hidden", marginBottom:"2rem", animation:"fadeUp 0.3s ease both", boxShadow:"0 4px 20px rgba(99,102,241,0.12)" }}>
      <div style={{ padding:"18px 22px", background:"linear-gradient(135deg,#312E81 0%,#4338CA 100%)", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:40, height:40, borderRadius:12, background:"rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:20 }}>🔍</div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ margin:0, fontSize:11, color:"#A5B4FC", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em" }}>Canais similares a</p>
          <p style={{ margin:0, fontSize:16, fontWeight:700, color:"#fff", letterSpacing:"-0.01em" }}>{channelName}</p>
        </div>
        <button onClick={onClose} style={{ width:34, height:34, borderRadius:10, background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.2)", cursor:"pointer", color:"#fff", flexShrink:0, fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>

      {result?.keywords?.length > 0 && (
        <div style={{ padding:"10px 22px", background:"#3730A3", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"#C7D2FE", fontWeight:600 }}>Temas extraídos:</span>
          {result.keywords.map((k, i) => (
            <span key={i} style={{ fontSize:11, background:"rgba(255,255,255,0.12)", color:"#E0E7FF", padding:"2px 10px", borderRadius:20, border:"1px solid rgba(255,255,255,0.15)" }}>{k}</span>
          ))}
        </div>
      )}

      <div style={{ padding:"22px", background:"var(--surface2)" }}>
        {loading && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14, padding:"2.5rem 0" }}>
            <div style={{ width:36, height:36, borderRadius:"50%", border:"3px solid var(--border)", borderTopColor:"#6366F1", animation:"spin 0.7s linear infinite" }} />
            <div style={{ textAlign:"center" }}>
              <p style={{ margin:"0 0 4px", fontSize:14, fontWeight:600, color:"var(--t1)", letterSpacing:"-0.01em" }}>Analisando vídeos de <strong>{channelName}</strong></p>
              <p style={{ margin:0, fontSize:12, color:"var(--t4)" }}>Extraindo temas e buscando canais similares...</p>
            </div>
          </div>
        )}
        {error && (
          <div style={{ padding:"14px 16px", background:"#FEF2F2", borderRadius:10, border:"1px solid #FECACA" }}>
            <p style={{ margin:0, fontSize:13, color:"#7F1D1D" }}>⚠ {error}</p>
          </div>
        )}
        {result && !loading && (
          <>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <p style={{ margin:0, fontSize:12, fontWeight:700, color:"var(--t2)", textTransform:"uppercase", letterSpacing:"0.07em" }}>Canais no mesmo nicho</p>
              <span style={{ fontSize:12, background:"#EEF2FF", color:"#4F46E5", padding:"3px 12px", borderRadius:20, fontWeight:700, border:"1px solid #C7D2FE" }}>{result.channels.length} canais</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:12 }}>
              {result.channels.map((ch, i) => <SimilarChannelCard key={i} ch={ch} index={i} />)}
            </div>
            {!result.channels.length && <p style={{ margin:0, fontSize:13, color:"var(--t4)", textAlign:"center", padding:"1.5rem 0" }}>Nenhum canal encontrado.</p>}
          </>
        )}
      </div>
    </div>
  );
}

const PROFILE_COLORS = ["#6366F1","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];

function FollowModal({ channelId, name, thumbnail, subscribers, profiles, followedChannels, onSave, onClose, onCreateProfile }) {
  const existing = followedChannels.find(c => c.channelId === channelId);
  const [selectedIds, setSelectedIds] = useState(existing?.profileIds || []);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);

  const toggle = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    const p = onCreateProfile(newName.trim());
    setSelectedIds(prev => [...prev, p.id]);
    setNewName(""); setShowNew(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:"var(--surface)", borderRadius:20, padding:24, maxWidth:360, width:"100%", boxShadow:"0 24px 48px rgba(0,0,0,0.35)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
          <SafeImg src={thumbnail} alt={name} fallbackName={name} fallbackSize={36} style={{ width:40, height:40, borderRadius:"50%", flexShrink:0 }} />
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</p>
            <p style={{ margin:0, fontSize:11, color:"var(--t3)" }}>{formatViews(subscribers || 0)} inscritos</p>
          </div>
          <button onClick={onClose} style={{ marginLeft:"auto", background:"none", border:"none", fontSize:18, color:"var(--t4)", cursor:"pointer", flexShrink:0 }}>×</button>
        </div>

        <p style={{ margin:"0 0 10px", fontSize:10, fontWeight:700, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.08em" }}>Adicionar ao perfil</p>

        {profiles.length === 0 && !showNew && (
          <p style={{ fontSize:13, color:"var(--t4)", margin:"0 0 12px" }}>Nenhum perfil criado ainda. Crie o primeiro abaixo.</p>
        )}

        {profiles.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
            {profiles.map(p => {
              const active = selectedIds.includes(p.id);
              return (
                <button key={p.id} onClick={() => toggle(p.id)}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", borderRadius:12, border:`1.5px solid ${active ? p.color : "var(--border)"}`, background:active ? `${p.color}22` : "var(--surface2)", cursor:"pointer", textAlign:"left", fontFamily:"inherit", transition:"all 0.15s" }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:p.color, flexShrink:0 }} />
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--t1)", flex:1 }}>{p.name}</span>
                  {active && <span style={{ fontSize:14, color:p.color, fontWeight:700 }}>✓</span>}
                </button>
              );
            })}
          </div>
        )}

        {showNew ? (
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome do perfil..." autoFocus
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowNew(false); }} />
            <button onClick={handleCreate}
              style={{ padding:"0 16px", borderRadius:10, border:"none", background:"#6366F1", color:"#fff", fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>
              Criar
            </button>
          </div>
        ) : (
          <button onClick={() => setShowNew(true)}
            style={{ width:"100%", padding:"9px", borderRadius:10, border:"1.5px dashed var(--border)", background:"transparent", color:"var(--t3)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", marginBottom:14, transition:"border-color 0.15s" }}>
            + Novo perfil
          </button>
        )}

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"9px", borderRadius:10, border:"1px solid var(--border)", background:"transparent", color:"var(--t2)", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            Cancelar
          </button>
          {existing && (
            <button onClick={() => onSave(channelId, name, thumbnail, subscribers || 0, [])}
              style={{ padding:"9px 14px", borderRadius:10, border:"1px solid #FCA5A5", background:"#FEF2F2", color:"#DC2626", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              Deixar de seguir
            </button>
          )}
          <button onClick={() => onSave(channelId, name, thumbnail, subscribers || 0, selectedIds)}
            style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:"#6366F1", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            {existing ? "Salvar" : "Seguir"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey]         = useState(() => localStorage.getItem("yt_api_key") || "");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [tema, setTema]             = useState("");
  const [direcionamento, setDirecionamento] = useState("");
  const [subtema, setSubtema]       = useState("");
  const [filters, setFilters]       = useState(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [videos, setVideos]         = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [sortMetrics, setSortMetrics] = useState([]);
  const [followedChannels, setFollowedChannels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yt_followed") || "[]"); } catch { return []; }
  });
  const [profiles, setProfiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yt_profiles") || "[]"); } catch { return []; }
  });
  const [activeProfile, setActiveProfile] = useState("all");
  const [followModal, setFollowModal] = useState(null);
  const [editingProfileId, setEditingProfileId] = useState(null);
  const [myChannelsView, setMyChannelsView] = useState(false);
  const [myChannelsVideos, setMyChannelsVideos] = useState(null);
  const [myChannelsLoading, setMyChannelsLoading] = useState(false);
  const [myChannelsError, setMyChannelsError] = useState(null);
  const [myChannelsOrder, setMyChannelsOrder] = useState("viewCount");
  const [myChannelsSortMetrics, setMyChannelsSortMetrics] = useState([]);
  const lastSearchRef = useRef({ query: "", filters: DEFAULT_FILTERS });
  const [niche, setNiche]           = useState(null);
  const [error, setError]           = useState(null);
  const [activeChannel, setActiveChannel] = useState(null);
  const [reportVideo, setReportVideo] = useState(null);
  const [dark, setDark]             = useState(() => localStorage.getItem("yt_dark") !== "0");
  const resultsRef = useRef(null);
  const similarRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    localStorage.setItem("yt_dark", dark ? "1" : "0");
  }, [dark]);

  const saveKey = (k) => { setApiKey(k); localStorage.setItem("yt_api_key", k); };

  const handleChannelClick = (name, channelId) => {
    if (activeChannel?.channelId === channelId) { setActiveChannel(null); return; }
    setActiveChannel({ name, channelId });
    setTimeout(() => similarRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 80);
  };

  const applyFilters = (items, f) => {
    const minV = parseViewsInput(f.minViews);
    const maxV = parseViewsInput(f.maxViews);
    const minS = parseViewsInput(f.minSubs);
    const maxS = parseViewsInput(f.maxSubs);
    let r = items;
    if (minV > 0) r = r.filter(v => v.viewsRaw >= minV);
    if (maxV > 0) r = r.filter(v => v.viewsRaw <= maxV);
    if (minS > 0) r = r.filter(v => (v.channelSubscribers || 0) >= minS);
    if (maxS > 0) r = r.filter(v => (v.channelSubscribers || 0) <= maxS);
    return r;
  };

  const search = async () => {
    if (!apiKey.trim()) return;
    const query = [tema, direcionamento, subtema].filter(Boolean).join(" ");
    setLoading(true); setError(null); setVideos(null); setNiche(null); setActiveChannel(null); setNextPageToken(null); setSortMetrics([]);
    try {
      // Resolve channel input to a channel ID before searching
      let resolvedFilters = filters;
      if (filters.channel?.trim()) {
        const channelId = await resolveChannelId(apiKey, filters.channel);
        if (!channelId) throw new Error(`Canal não encontrado: "${filters.channel}"`);
        resolvedFilters = { ...filters, channelId };
      }
      lastSearchRef.current = { query, filters: resolvedFilters };
      const { items: raw, nextPageToken: npt } = await searchVideos(apiKey, query, resolvedFilters);
      const result = applyFilters(raw, resolvedFilters);
      setVideos(result);
      setNextPageToken(npt);
      setNiche(analyzeNiche(result));
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextPageToken || loading) return;
    const { query, filters: f } = lastSearchRef.current;
    setLoading(true);
    try {
      const { items: raw, nextPageToken: npt } = await searchVideos(apiKey, query, f, nextPageToken);
      const more = applyFilters(raw, f);
      setVideos(prev => [...prev, ...more]);
      setNextPageToken(npt);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const createProfile = (name) => {
    const color = PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
    const p = { id: Date.now().toString(), name, color };
    setProfiles(prev => {
      const next = [...prev, p];
      localStorage.setItem("yt_profiles", JSON.stringify(next));
      return next;
    });
    return p;
  };

  const renameProfile = (id, newName) => {
    setProfiles(prev => {
      const next = prev.map(p => p.id === id ? { ...p, name: newName } : p);
      localStorage.setItem("yt_profiles", JSON.stringify(next));
      return next;
    });
    setEditingProfileId(null);
  };

  const deleteProfile = (id) => {
    setProfiles(prev => {
      const next = prev.filter(p => p.id !== id);
      localStorage.setItem("yt_profiles", JSON.stringify(next));
      return next;
    });
    setFollowedChannels(prev => {
      const next = prev.map(c => ({ ...c, profileIds: (c.profileIds || []).filter(pid => pid !== id) }));
      localStorage.setItem("yt_followed", JSON.stringify(next));
      return next;
    });
    if (activeProfile === id) setActiveProfile("all");
  };

  const saveFollow = (channelId, name, thumbnail, subscribers, profileIds) => {
    setFollowedChannels(prev => {
      let next;
      if (profileIds.length === 0) {
        next = prev.filter(c => c.channelId !== channelId);
      } else {
        const exists = prev.find(c => c.channelId === channelId);
        if (exists) {
          next = prev.map(c => c.channelId === channelId ? { ...c, profileIds } : c);
        } else {
          next = [...prev, { channelId, name, thumbnail, subscribers, profileIds }];
        }
      }
      localStorage.setItem("yt_followed", JSON.stringify(next));
      return next;
    });
    setFollowModal(null);
  };

  const openFollowModal = (channelId, name, thumbnail, subscribers) => {
    setFollowModal({ channelId, name, thumbnail, subscribers });
  };

  const fetchMyChannelsVideos = async () => {
    if (!followedChannels.length || myChannelsLoading) return;
    setMyChannelsLoading(true);
    setMyChannelsError(null);
    setMyChannelsVideos(null);
    setMyChannelsSortMetrics([]);
    try {
      const channelsToFetch = activeProfile === "all"
        ? followedChannels
        : followedChannels.filter(c => (c.profileIds || []).includes(activeProfile));
      if (!channelsToFetch.length) { setMyChannelsVideos([]); setMyChannelsLoading(false); return; }
      const chIds = channelsToFetch.map(c => c.channelId).join(",");
      const chBatch = await ytFetch(apiKey, `/channels?part=statistics,snippet&id=${chIds}`);
      const chMap = {};
      for (const c of chBatch.items || []) {
        chMap[c.id] = {
          thumbnail:   c.snippet?.thumbnails?.medium?.url || c.snippet?.thumbnails?.default?.url || "",
          subscribers: Number(c.statistics?.subscriberCount) || 0,
          totalViews:  Number(c.statistics?.viewCount)       || 0,
          videoCount:  Number(c.statistics?.videoCount)      || 1,
        };
      }
      const allVideos = [];
      for (const ch of channelsToFetch) {
        const searchData = await ytFetch(apiKey,
          `/search?part=snippet&channelId=${ch.channelId}&type=video&maxResults=20&order=${myChannelsOrder}`
        );
        const items = searchData.items || [];
        const videoIds = items.map(i => i.id?.videoId).filter(Boolean).join(",");
        if (!videoIds) continue;
        const statsData = await ytFetch(apiKey, `/videos?part=statistics,contentDetails&id=${videoIds}`);
        const statsMap = {};
        for (const s of statsData.items || []) {
          statsMap[s.id] = { stats: s.statistics, dur: parseDuration(s.contentDetails?.duration) };
        }
        const chInfo = chMap[ch.channelId] || {};

        // Collect all fetched view counts for this channel to use as peer baseline
        const fetchedViews = items
          .filter(i => i.id?.videoId)
          .map(i => Number(statsMap[i.id.videoId]?.stats?.viewCount) || 0);

        for (const item of items.filter(i => i.id?.videoId)) {
          const id = item.id.videoId;
          const si = statsMap[id] || {};
          const stats = si.stats || {};
          const dur = si.dur || { sec: 0, str: "—" };
          const views = Number(stats.viewCount) || 0;
          const rawH = (Date.now() - new Date(item.snippet.publishedAt)) / 36e5;
          allVideos.push({
            type: "video", videoId: id,
            url: `https://www.youtube.com/watch?v=${id}`,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            channelId: item.snippet.channelId,
            channelUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`,
            channelThumbnail: chInfo.thumbnail || ch.thumbnail || "",
            channelSubscribers: chInfo.subscribers || ch.subscribers || 0,
            thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
            views: formatViews(views), viewsRaw: views,
            vph: views / Math.max(1, rawH),
            outlier: fetchedViews.length >= 2
              ? calcOutlierFromPeers(views, fetchedViews)
              : calcOutlier(views, chInfo.totalViews, chInfo.videoCount),
            hoursOld: rawH,
            likesRaw: Number(stats.likeCount) || 0,
            commentsRaw: Number(stats.commentCount) || 0,
            durationSec: dur.sec, durationStr: dur.str,
            publishedAt: formatDate(item.snippet.publishedAt),
            description: item.snippet.description?.slice(0, 120) || "",
          });
        }
      }
      if (myChannelsOrder === "date") {
        allVideos.sort((a, b) => a.hoursOld - b.hoursOld);
      } else {
        allVideos.sort((a, b) => b.viewsRaw - a.viewsRaw);
      }
      setMyChannelsVideos(allVideos);
    } catch (e) {
      setMyChannelsError(e.message);
    } finally {
      setMyChannelsLoading(false);
    }
  };

  const SORT_OPTIONS = [
    { key: "oportunidade", label: "Oportunidade", desc: "Índice composto: outlier ajustado + velocidade absoluta" },
    { key: "outlier",      label: "Outlier",       desc: "Acima da média do canal" },
    { key: "vph",          label: "VPH",           desc: "Velocidade de crescimento" },
    { key: "views",        label: "Views",          desc: "Total de visualizações" },
    { key: "recencia",     label: "Recente",        desc: "Publicados mais recentemente" },
    { key: "pequenos",     label: "Canal Pequeno",  desc: "Canais com menos inscritos" },
  ];

  const sortedVideos = useMemo(() => {
    if (!videos || !videos.length || !sortMetrics.length) return videos;
    const getters = {
      oportunidade: v => calcOpportunityScore(v).score,
      outlier:  v => v.outlier || 0,
      vph:      v => v.vph || 0,
      views:    v => v.viewsRaw || 0,
      recencia: v => 1 / Math.max(1, v.hoursOld || 1),
      pequenos: v => 1 / Math.max(1, v.channelSubscribers || 1),
    };
    const active = sortMetrics.filter(m => getters[m]);
    if (!active.length) return videos;
    const normalize = (vals) => {
      const max = Math.max(...vals), min = Math.min(...vals);
      const range = max - min;
      return vals.map(v => range === 0 ? 0.5 : (v - min) / range);
    };
    const norms = active.map(m => normalize(videos.map(getters[m])));
    const scores = videos.map((_, i) =>
      active.reduce((sum, _, mi) => sum + norms[mi][i], 0) / active.length
    );
    return [...videos]
      .map((v, i) => ({ v, s: scores[i] }))
      .sort((a, b) => b.s - a.s)
      .map(({ v }) => v);
  }, [videos, sortMetrics]);

  const sortedMyChannelsVideos = useMemo(() => {
    if (!myChannelsVideos || !myChannelsVideos.length || !myChannelsSortMetrics.length) return myChannelsVideos;
    const getters = {
      oportunidade: v => calcOpportunityScore(v).score,
      outlier:  v => v.outlier || 0,
      vph:      v => v.vph || 0,
      views:    v => v.viewsRaw || 0,
      recencia: v => 1 / Math.max(1, v.hoursOld || 1),
      pequenos: v => 1 / Math.max(1, v.channelSubscribers || 1),
    };
    const active = myChannelsSortMetrics.filter(m => getters[m]);
    if (!active.length) return myChannelsVideos;
    const normalize = (vals) => {
      const max = Math.max(...vals), min = Math.min(...vals);
      const range = max - min;
      return vals.map(v => range === 0 ? 0.5 : (v - min) / range);
    };
    const norms = active.map(m => normalize(myChannelsVideos.map(getters[m])));
    const scores = myChannelsVideos.map((_, i) =>
      active.reduce((sum, _, mi) => sum + norms[mi][i], 0) / active.length
    );
    return [...myChannelsVideos]
      .map((v, i) => ({ v, s: scores[i] }))
      .sort((a, b) => b.s - a.s)
      .map(({ v }) => v);
  }, [myChannelsVideos, myChannelsSortMetrics]);

  const canSearch = apiKey.trim() && !loading;
  const sc  = niche ? scoreColor(niche.opportunityScore) : null;
  const sat = niche ? satColor(niche.saturationLevel)   : null;
  const activeFilterCount = [
    filters.tipo !== "video" ? 1 : 0,
    filters.duracao ? 1 : 0,
    filters.data ? 1 : 0,
    filters.caracteristicas.length,
    filters.ordem !== "viewCount" ? 1 : 0,
    filters.minViews ? 1 : 0,
    filters.maxViews ? 1 : 0,
    filters.minSubs ? 1 : 0,
    filters.maxSubs ? 1 : 0,
    filters.country ? 1 : 0,
  ].reduce((a,b) => a+b, 0);

  return (
    <>
      <style>{`
        :root {
          --bg: #F1F5F9; --surface: #ffffff; --surface2: #F8FAFC;
          --border: #E2E8F0; --border2: #F1F5F9;
          --t1: #0F172A; --t2: #475569; --t3: #64748B; --t4: #94A3B8; --t5: #CBD5E1;
        }
        body.dark {
          --bg: #080D18;
          --surface: #101828;
          --surface2: #182035;
          --border: #2A3A58;
          --border2: #182035;
          --t1: #EEF2FF;
          --t2: #C4D0E8;
          --t3: #8EA3BF;
          --t4: #607590;
          --t5: #2A3A58;
        }
        body { background: var(--bg); transition: background 0.2s; }
        body.dark .video-card { box-shadow: 0 2px 12px rgba(0,0,0,0.45); }
        body.dark .video-card:hover { box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important; }
        body.dark .card-panel { border-color: #2A3A58 !important; box-shadow: 0 2px 16px rgba(0,0,0,0.4); }
        body.dark .card-panel:hover { border-color: #3D5480 !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes spin { to { transform:rotate(360deg) } }
        *, *::before, *::after { box-sizing:border-box; }
        input { width:100%; padding:9px 14px; border:1.5px solid var(--border); border-radius:10px; font-size:13px; background:var(--surface); color:var(--t1); outline:none; transition:border-color 0.15s, box-shadow 0.15s; font-family:inherit; }
        input:focus { border-color:#6366F1; box-shadow:0 0 0 3px rgba(99,102,241,0.12); }
        input:disabled { opacity:0.5; cursor:not-allowed; }
        input::placeholder { color:var(--t4); }

        .video-grid {
          display: grid;
          gap: 20px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 540px) {
          .video-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 860px) {
          .video-grid { grid-template-columns: repeat(3, 1fr); }
        }
        @media (min-width: 1180px) {
          .video-grid { grid-template-columns: repeat(4, 1fr); }
        }

        .main-wrap { padding: 20px 16px 60px; }
        @media (min-width: 640px) {
          .main-wrap { padding: 28px 24px 60px; }
        }

        .search-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 540px) {
          .search-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 860px) {
          .search-grid { grid-template-columns: repeat(3, 1fr); }
        }

        .kpi-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(2, 1fr);
        }
        @media (min-width: 640px) {
          .kpi-grid { grid-template-columns: repeat(4, 1fr); }
        }
      `}</style>

      {reportVideo && <ReportModal video={reportVideo} onClose={() => setReportVideo(null)} apiKey={apiKey} />}

      {followModal && (
        <FollowModal
          channelId={followModal.channelId}
          name={followModal.name}
          thumbnail={followModal.thumbnail}
          subscribers={followModal.subscribers}
          profiles={profiles}
          followedChannels={followedChannels}
          onSave={saveFollow}
          onClose={() => setFollowModal(null)}
          onCreateProfile={createProfile}
        />
      )}

      <header style={{ background:"#0F172A", position:"sticky", top:0, zIndex:100, borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth:1280, margin:"0 auto", padding:"12px 16px", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:11, flex:"0 0 auto" }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#6366F1,#4F46E5)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, boxShadow:"0 0 0 1px rgba(255,255,255,0.08) inset" }}>⛏</div>
            <div>
              <p style={{ margin:0, fontSize:15, fontWeight:700, color:"#fff", lineHeight:1.2, letterSpacing:"-0.02em" }}>Minerador de Nichos</p>
              <p style={{ margin:0, fontSize:11, color:"#475569" }}>YouTube Data Intelligence</p>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:220, maxWidth:440, marginLeft:"auto" }}>
            <span style={{ fontSize:11, fontWeight:700, color:apiKey?"#818CF8":"#F59E0B", flexShrink:0, whiteSpace:"nowrap" }}>
              {apiKey ? "🔑 ✓" : "🔑 API Key"}
            </span>
            <div style={{ flex:1, position:"relative" }}>
              <input
                type={apiKeyVisible?"text":"password"} value={apiKey} onChange={e=>saveKey(e.target.value)} placeholder="Cole sua chave da API..."
                style={{ background:"rgba(255,255,255,0.06)", border:`1.5px solid ${apiKey?"#6366F1":"rgba(255,255,255,0.1)"}`, color:apiKey?"#C7D2FE":"#94A3B8", paddingRight:68, borderRadius:10 }}
              />
              <button onClick={()=>setApiKeyVisible(v=>!v)} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#64748B", padding:0, fontFamily:"inherit" }}>
                {apiKeyVisible?"Ocultar":"Mostrar"}
              </button>
            </div>
          </div>
          <button onClick={() => { setMyChannelsView(v => !v); }}
            title="Meus Canais"
            style={{ position:"relative", height:36, borderRadius:10, background: myChannelsView ? "#6366F1" : "rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)", cursor:"pointer", color:"#fff", fontSize:13, fontWeight:600, padding:"0 14px", display:"flex", alignItems:"center", gap:6, flexShrink:0, transition:"background 0.15s", whiteSpace:"nowrap" }}>
            🔔 Meus Canais
            {followedChannels.length > 0 && (
              <span style={{ background:"#EF4444", color:"#fff", fontSize:10, fontWeight:800, borderRadius:20, padding:"1px 6px", minWidth:16, textAlign:"center" }}>{followedChannels.length}</span>
            )}
          </button>
          <button onClick={() => setDark(d => !d)} title={dark ? "Modo claro" : "Modo escuro"}
            style={{ width:36, height:36, borderRadius:10, background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)", cursor:"pointer", color:"#fff", fontSize:17, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"background 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.background="rgba(255,255,255,0.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.08)"; }}
          >
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <main className="main-wrap" style={{ maxWidth:1280, margin:"0 auto" }}>

        {!apiKey && (
          <div style={{ marginBottom:20, padding:"16px 20px", background:"#FFFBEB", border:"1px solid #FCD34D", borderRadius:14 }}>
            <p style={{ margin:"0 0 8px", fontSize:13, fontWeight:700, color:"#78350F" }}>Como obter a chave gratuita do YouTube:</p>
            <ol style={{ margin:0, paddingLeft:20, fontSize:13, color:"#92400E", lineHeight:2 }}>
              <li>Acesse <strong>console.cloud.google.com</strong> com sua conta Google</li>
              <li>Crie um projeto → Ative <strong>YouTube Data API v3</strong></li>
              <li>Vá em <strong>Credenciais → Criar credencial → Chave de API</strong></li>
              <li>Cole a chave no campo acima (começa com <code style={{ background:"rgba(0,0,0,0.06)", padding:"1px 6px", borderRadius:4, fontSize:12 }}>AIza</code>)</li>
            </ol>
          </div>
        )}

        <div className="card-panel" style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:18, padding:"26px", marginBottom:14, boxShadow:"0 4px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ marginBottom:20 }}>
            <p style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:"var(--t1)", letterSpacing:"-0.03em" }}>Pesquisar nicho</p>
            <p style={{ margin:0, fontSize:13, color:"var(--t3)" }}>Busque por tema ou pelo nome de um canal específico.</p>
          </div>
          <div className="search-grid" style={{ marginBottom:12 }}>
            {[
              { key:"tema",           label:"Tema",          placeholder:"ex: fitness, culinária",   val:tema,           set:setTema },
              { key:"direcionamento", label:"Direcionamento", placeholder:"ex: iniciantes, mulheres", val:direcionamento, set:setDirecionamento },
              { key:"subtema",        label:"Subtema",        placeholder:"ex: treino em casa",       val:subtema,        set:setSubtema },
            ].map(({ key, label, placeholder, val, set }) => (
              <div key={key}>
                <label style={{ display:"block", marginBottom:6, fontSize:11, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.07em" }}>
                  {label} <span style={{ fontWeight:400, color:"var(--t4)", textTransform:"none", letterSpacing:0 }}>(opcional)</span>
                </label>
                <input value={val} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder={placeholder} disabled={loading} />
              </div>
            ))}
          </div>

          {/* Canal field — full width, visually separated */}
          <div style={{ marginBottom:20, padding:"14px 16px", background:"var(--surface2)", borderRadius:12, border:`1.5px solid ${filters.channel ? "#6366F1" : "var(--border)"}`, transition:"border-color 0.15s" }}>
            <label style={{ display:"block", marginBottom:6, fontSize:11, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:"0.07em" }}>
              📺 Canal <span style={{ fontWeight:400, color:"var(--t4)", textTransform:"none", letterSpacing:0 }}>— restringe a busca a um canal específico (opcional)</span>
            </label>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <input
                value={filters.channel || ""}
                onChange={e => setFilters(f => ({ ...f, channel: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && search()}
                placeholder="Nome do canal, @handle ou URL — ex: Back To Surviving"
                disabled={loading}
                style={{ flex:1 }}
              />
              {filters.channel && (
                <button onClick={() => setFilters(f => ({ ...f, channel: "", channelId: undefined }))}
                  style={{ flexShrink:0, padding:"8px 14px", borderRadius:9, border:"1px solid #FECACA", background:"#FEF2F2", color:"#DC2626", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                  ✕
                </button>
              )}
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
            <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
              {(tema||direcionamento||subtema) && (
                <div style={{ padding:"6px 14px", background:"#EEF2FF", border:"1px solid #C7D2FE", borderRadius:20, display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:12, color:"#4F46E5", fontFamily:"monospace", fontWeight:500 }}>
                    🔎 &quot;{[tema,direcionamento,subtema].filter(Boolean).join(" ")}&quot;
                  </span>
                </div>
              )}
              <button
                onClick={()=>setShowFilters(v=>!v)}
                style={{ display:"flex", alignItems:"center", gap:7, padding:"8px 16px", border:`1.5px solid ${showFilters||activeFilterCount>0?"#6366F1":"var(--border)"}`, borderRadius:20, background:showFilters?"#EEF2FF":"var(--surface)", color:showFilters?"#4F46E5":"var(--t2)", fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:600, transition:"all 0.15s" }}
              >
                ⚙ Filtros
                {activeFilterCount > 0 && <span style={{ background:"#6366F1", color:"#fff", borderRadius:20, padding:"1px 8px", fontSize:11, fontWeight:700 }}>{activeFilterCount}</span>}
              </button>
            </div>
            <button
              onClick={search} disabled={!canSearch}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 26px", background:canSearch?"linear-gradient(135deg,#6366F1,#4F46E5)":"var(--border)", color:canSearch?"#fff":"var(--t4)", border:"none", borderRadius:20, fontSize:14, fontWeight:700, cursor:canSearch?"pointer":"not-allowed", fontFamily:"inherit", boxShadow:canSearch?"0 4px 14px rgba(99,102,241,0.35)":"none", letterSpacing:"-0.01em", transition:"all 0.2s" }}
            >
              {loading
                ? <><div style={{ width:16, height:16, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.7s linear infinite" }} /> Minerando...</>
                : <>⛏ Minerar nicho</>
              }
            </button>
          </div>
        </div>

        {showFilters && <FilterPanel filters={filters} onChange={setFilters} onClear={()=>setFilters(DEFAULT_FILTERS)} />}

        {error && (
          <div style={{ marginTop:16, padding:"14px 18px", background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:14 }}>
            <p style={{ margin:"0 0 3px", fontSize:13, fontWeight:700, color:"#7F1D1D" }}>⚠ Erro na pesquisa</p>
            <p style={{ margin:0, fontSize:13, color:"#991B1B" }}>{error}</p>
          </div>
        )}

        {videos && (
          <div ref={resultsRef} style={{ marginTop:28 }}>

            {niche && sc && sat && (
              <div style={{ marginBottom:28 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
                  <div style={{ width:4, height:22, background:"linear-gradient(180deg,#6366F1,#4F46E5)", borderRadius:2 }} />
                  <p style={{ margin:0, fontSize:15, fontWeight:800, color:"var(--t1)", letterSpacing:"-0.02em" }}>Análise do Nicho</p>
                </div>
                <div className="kpi-grid" style={{ marginBottom:14 }}>
                  {[
                    { label:"Oportunidade", border:sc.border, body:<>
                        <div style={{ display:"flex", alignItems:"baseline", gap:3, marginBottom:10 }}>
                          <span style={{ fontSize:38, fontWeight:900, color:sc.text, lineHeight:1, letterSpacing:"-0.04em" }}>{niche.opportunityScore}</span>
                          <span style={{ fontSize:14, color:"var(--t4)" }}>/100</span>
                        </div>
                        <span style={{ fontSize:12, fontWeight:700, background:sc.bg, color:sc.text, padding:"4px 12px", borderRadius:20 }}>{sc.label}</span>
                      </> },
                    { label:"Saturação", body:<>
                        <span style={{ fontSize:28, fontWeight:900, color:sat.text, lineHeight:1, display:"block", marginBottom:10, letterSpacing:"-0.03em" }}>{niche.saturationLevel}</span>
                        <span style={{ fontSize:12, fontWeight:600, background:sat.bg, color:sat.text, padding:"4px 12px", borderRadius:20 }}>{niche.totalChannels} canais</span>
                      </> },
                    { label:"Média de Views", body:<>
                        <span style={{ fontSize:28, fontWeight:900, color:"var(--t1)", lineHeight:1, display:"block", marginBottom:10, letterSpacing:"-0.03em" }}>{niche.avgViews}</span>
                        <span style={{ fontSize:12, color:"var(--t4)" }}>por vídeo</span>
                      </> },
                    { label:"Canais Ativos", body:<>
                        <span style={{ fontSize:38, fontWeight:900, color:"var(--t1)", lineHeight:1, display:"block", marginBottom:10, letterSpacing:"-0.04em" }}>{niche.totalChannels}</span>
                        <span style={{ fontSize:12, color:"var(--t4)" }}>produtores</span>
                      </> },
                  ].map((item, i) => (
                    <div key={i} className="card-panel" style={{ background:"var(--surface)", border:`1px solid ${item.border||"var(--border)"}`, borderRadius:16, padding:"20px", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                      <p style={{ margin:"0 0 12px", fontSize:10, fontWeight:700, color:"var(--t4)", textTransform:"uppercase", letterSpacing:"0.09em" }}>{item.label}</p>
                      {item.body}
                    </div>
                  ))}
                </div>
                <div style={{ padding:"16px 20px", background:"linear-gradient(135deg,#F0FDF4,#ECFDF5)", borderRadius:14, borderLeft:"4px solid #10B981", display:"flex", gap:14, alignItems:"flex-start" }}>
                  <span style={{ fontSize:22, flexShrink:0 }}>💡</span>
                  <div>
                    <p style={{ margin:"0 0 4px", fontSize:10, fontWeight:700, color:"#064E3B", textTransform:"uppercase", letterSpacing:"0.09em" }}>Recomendação</p>
                    <p style={{ margin:0, fontSize:13, color:"#065F46", lineHeight:1.65, fontWeight:500 }}>{niche.recommendation}</p>
                  </div>
                </div>
              </div>
            )}

            {activeChannel && (
              <div ref={similarRef}>
                <SimilarPanel key={activeChannel.channelId} channelName={activeChannel.name} channelId={activeChannel.channelId} apiKey={apiKey} onClose={()=>setActiveChannel(null)} />
              </div>
            )}

            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:4, height:22, background:"linear-gradient(180deg,#6366F1,#4F46E5)", borderRadius:2 }} />
                <p style={{ margin:0, fontSize:15, fontWeight:800, color:"var(--t1)", letterSpacing:"-0.02em" }}>Resultados</p>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {sortMetrics.length === 0 && <span style={{ fontSize:12, color:"var(--t4)" }}>por popularidade</span>}
                <span style={{ fontSize:12, background:"#EEF2FF", color:"#4F46E5", padding:"4px 14px", borderRadius:20, fontWeight:700, border:"1px solid #C7D2FE" }}>{videos.length} resultados</span>
              </div>
            </div>

            {/* Dynamic sort bar */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:18, padding:"12px 14px", background:"var(--surface2)", borderRadius:12, border:"1px solid var(--border)" }}>
              <span style={{ fontSize:12, fontWeight:700, color:"var(--t3)", alignSelf:"center", marginRight:4 }}>Ordenar por:</span>
              {SORT_OPTIONS.map(opt => {
                const active = sortMetrics.includes(opt.key);
                return (
                  <button
                    key={opt.key}
                    title={opt.desc}
                    onClick={() => setSortMetrics(prev =>
                      active ? prev.filter(k => k !== opt.key) : [...prev, opt.key]
                    )}
                    style={{
                      padding:"5px 14px", borderRadius:20, fontSize:12, fontWeight:700,
                      cursor:"pointer", transition:"all 0.15s",
                      border: active ? "1.5px solid #6366F1" : "1.5px solid var(--border)",
                      background: active ? "#6366F1" : "var(--surface)",
                      color: active ? "#fff" : "var(--t2)",
                    }}
                  >
                    {sortMetrics.indexOf(opt.key) >= 0
                      ? `${sortMetrics.indexOf(opt.key) + 1}. ${opt.label}`
                      : opt.label}
                  </button>
                );
              })}
              {sortMetrics.length > 0 && (
                <button
                  onClick={() => setSortMetrics([])}
                  style={{
                    padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600,
                    cursor:"pointer", border:"1.5px solid var(--border)",
                    background:"transparent", color:"var(--t4)",
                  }}
                >
                  Resetar
                </button>
              )}
            </div>

            <div className="video-grid">
              {sortedVideos.map((video, i) => (
                <VideoCard
                  key={video.videoId||video.channelId||i}
                  video={video} index={i} rank={i+1}
                  onChannelClick={video.type==="video" ? handleChannelClick : null}
                  onReportClick={video.type==="video" ? setReportVideo : null}
                  onFollowToggle={video.type==="video" ? openFollowModal : null}
                  isFollowed={followedChannels.some(c => c.channelId === video.channelId)}
                />
              ))}
            </div>

            {!videos.length && (
              <div style={{ textAlign:"center", padding:"3.5rem 0" }}>
                <p style={{ fontSize:36, margin:"0 0 8px" }}>🔍</p>
                <p style={{ fontSize:16, fontWeight:700, color:"var(--t1)", margin:"0 0 4px", letterSpacing:"-0.01em" }}>Nenhum resultado</p>
                <p style={{ fontSize:13, color:"var(--t4)", margin:0 }}>Tente ajustar os filtros ou termos de pesquisa.</p>
              </div>
            )}

            {nextPageToken && (
              <div style={{ textAlign:"center", marginTop:24 }}>
                <button
                  onClick={loadMore}
                  disabled={loading}
                  style={{
                    padding:"10px 32px", borderRadius:10, border:"1.5px solid #6366F1",
                    background:"var(--surface)", color:"#6366F1",
                    fontSize:14, fontWeight:700, cursor:"pointer", letterSpacing:"-0.01em",
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {loading ? "Carregando..." : "Carregar mais"}
                </button>
              </div>
            )}

            <p style={{ marginTop:22, fontSize:11, color:"var(--t5)", textAlign:"center" }}>
              Clique no thumbnail para abrir no YouTube · &quot;Canais similares&quot; analisa o nicho · &quot;📊 Relatório&quot; gera análise viral detalhada
            </p>
          </div>
        )}
      </main>

      {myChannelsView && (
        <div style={{ position:"fixed", inset:0, zIndex:200, background:"var(--bg)", overflowY:"auto" }}>
          <div style={{ maxWidth:1280, margin:"0 auto", padding:"24px 16px 60px" }}>

            {/* Header */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, flexWrap:"wrap" }}>
              <button onClick={() => setMyChannelsView(false)}
                style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10, padding:"7px 14px", cursor:"pointer", fontSize:13, color:"var(--t2)", fontFamily:"inherit", fontWeight:600 }}>
                ← Voltar
              </button>
              <div style={{ width:4, height:22, background:"linear-gradient(180deg,#6366F1,#4F46E5)", borderRadius:2 }} />
              <p style={{ margin:0, fontSize:16, fontWeight:800, color:"var(--t1)", letterSpacing:"-0.02em" }}>Meus Canais</p>
              <span style={{ fontSize:12, background:"#EEF2FF", color:"#4F46E5", padding:"4px 12px", borderRadius:20, fontWeight:700, border:"1px solid #C7D2FE" }}>{followedChannels.length} seguidos</span>
            </div>

            {/* Profile tabs */}
            <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:20, flexWrap:"wrap" }}>
              {/* Todos */}
              <button onClick={() => setActiveProfile("all")}
                style={{ padding:"6px 16px", borderRadius:20, fontSize:13, fontWeight:700, cursor:"pointer", border:`1.5px solid ${activeProfile==="all"?"#6366F1":"var(--border)"}`, background:activeProfile==="all"?"#6366F1":"var(--surface)", color:activeProfile==="all"?"#fff":"var(--t2)", transition:"all 0.15s" }}>
                Todos
              </button>

              {profiles.map(p => (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:0, borderRadius:20, overflow:"hidden", border:`1.5px solid ${activeProfile===p.id?p.color:"var(--border)"}`, background:activeProfile===p.id?`${p.color}22`:"var(--surface)", transition:"all 0.15s" }}>
                  {editingProfileId === p.id ? (
                    <input
                      autoFocus
                      defaultValue={p.name}
                      onBlur={e => { if (e.target.value.trim()) renameProfile(p.id, e.target.value.trim()); else setEditingProfileId(null); }}
                      onKeyDown={e => { if (e.key==="Enter" && e.target.value.trim()) renameProfile(p.id, e.target.value.trim()); if (e.key==="Escape") setEditingProfileId(null); }}
                      style={{ width:100, padding:"4px 10px", border:"none", background:"transparent", fontSize:13, fontWeight:700, color:"var(--t1)", outline:"none" }}
                    />
                  ) : (
                    <button onClick={() => setActiveProfile(p.id)}
                      style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 12px", border:"none", background:"transparent", cursor:"pointer", fontFamily:"inherit" }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:p.color, flexShrink:0 }} />
                      <span style={{ fontSize:13, fontWeight:700, color:activeProfile===p.id?p.color:"var(--t2)", whiteSpace:"nowrap" }}>{p.name}</span>
                      <span style={{ fontSize:11, color:"var(--t4)", marginLeft:2 }}>
                        {followedChannels.filter(c=>(c.profileIds||[]).includes(p.id)).length}
                      </span>
                    </button>
                  )}
                  <div style={{ display:"flex", alignItems:"center", borderLeft:"1px solid var(--border)" }}>
                    <button onClick={() => setEditingProfileId(editingProfileId===p.id?null:p.id)} title="Renomear"
                      style={{ padding:"6px 7px", border:"none", background:"transparent", cursor:"pointer", fontSize:11, color:"var(--t4)", lineHeight:1 }}>✏</button>
                    <button onClick={() => { if (window.confirm(`Excluir perfil "${p.name}"?`)) deleteProfile(p.id); }} title="Excluir"
                      style={{ padding:"6px 7px", border:"none", background:"transparent", cursor:"pointer", fontSize:11, color:"#EF4444", lineHeight:1 }}>✕</button>
                  </div>
                </div>
              ))}

              {/* Novo perfil inline */}
              <button onClick={() => { const name = window.prompt("Nome do novo perfil:"); if (name?.trim()) createProfile(name.trim()); }}
                style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer", border:"1.5px dashed var(--border)", background:"transparent", color:"var(--t3)", transition:"all 0.15s" }}>
                + Novo Perfil
              </button>
            </div>

            {followedChannels.length === 0 ? (
              <div style={{ textAlign:"center", padding:"4rem 0" }}>
                <p style={{ fontSize:40, margin:"0 0 12px" }}>🔔</p>
                <p style={{ fontSize:15, fontWeight:700, color:"var(--t1)", margin:"0 0 6px" }}>Nenhum canal seguido ainda</p>
                <p style={{ fontSize:13, color:"var(--t4)", margin:0 }}>Clique em <strong>+ Seguir</strong> nos cards de vídeo para adicionar canais aqui.</p>
              </div>
            ) : (
              <>
                {/* Canal list filtered by active profile */}
                {(() => {
                  const visibleChannels = activeProfile === "all"
                    ? followedChannels
                    : followedChannels.filter(c => (c.profileIds || []).includes(activeProfile));
                  return (
                    <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:16, padding:"18px 20px", marginBottom:22 }}>
                      {visibleChannels.length === 0 ? (
                        <p style={{ margin:0, fontSize:13, color:"var(--t4)", textAlign:"center", padding:"1rem 0" }}>Nenhum canal neste perfil ainda.</p>
                      ) : (
                        <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
                          {visibleChannels.map(ch => (
                            <div key={ch.channelId} style={{ display:"flex", alignItems:"center", gap:8, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:12, padding:"8px 12px" }}>
                              <SafeImg src={ch.thumbnail} alt={ch.name} fallbackName={ch.name} fallbackSize={32} style={{ width:34, height:34, borderRadius:"50%", border:`2px solid ${profiles.find(p=>(ch.profileIds||[]).includes(p.id))?.color||"#6366F1"}` }} />
                              <div style={{ minWidth:0 }}>
                                <p style={{ margin:0, fontSize:12, fontWeight:700, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:120 }}>{ch.name}</p>
                                <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                                  {(ch.profileIds||[]).map(pid => {
                                    const prof = profiles.find(p => p.id === pid);
                                    return prof ? <span key={pid} style={{ fontSize:9, fontWeight:700, background:`${prof.color}22`, color:prof.color, borderRadius:20, padding:"1px 6px" }}>{prof.name}</span> : null;
                                  })}
                                </div>
                              </div>
                              <button onClick={() => openFollowModal(ch.channelId, ch.name, ch.thumbnail, ch.subscribers)}
                                style={{ marginLeft:4, padding:"4px 10px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", color:"var(--t3)", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                                Gerenciar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Controles de busca */}
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontSize:12, fontWeight:700, color:"var(--t3)" }}>Ordenar por:</span>
                        {[{v:"viewCount",l:"Popularidade"},{v:"date",l:"Mais recentes"}].map(o => (
                          <button key={o.v} onClick={() => setMyChannelsOrder(o.v)}
                            style={{ padding:"5px 14px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer", border:`1.5px solid ${myChannelsOrder===o.v?"#6366F1":"var(--border)"}`, background:myChannelsOrder===o.v?"#6366F1":"var(--surface)", color:myChannelsOrder===o.v?"#fff":"var(--t2)", transition:"all 0.15s" }}>
                            {o.l}
                          </button>
                        ))}
                        <button onClick={fetchMyChannelsVideos} disabled={myChannelsLoading}
                          style={{ marginLeft:"auto", padding:"8px 22px", borderRadius:20, border:"none", background:"linear-gradient(135deg,#6366F1,#4F46E5)", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", opacity:myChannelsLoading?0.7:1, boxShadow:"0 4px 12px rgba(99,102,241,0.35)" }}>
                          {myChannelsLoading ? "Buscando…" : "🔍 Buscar Vídeos"}
                        </button>
                      </div>
                      {myChannelsError && <p style={{ margin:"10px 0 0", fontSize:12, color:"#EF4444" }}>Erro: {myChannelsError}</p>}
                    </div>
                  );
                })()}

                {/* Resultados */}
                {myChannelsVideos && (
                  <>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
                      <span style={{ fontSize:15, fontWeight:800, color:"var(--t1)" }}>Vídeos dos canais seguidos</span>
                      <span style={{ fontSize:12, background:"#EEF2FF", color:"#4F46E5", padding:"4px 14px", borderRadius:20, fontWeight:700, border:"1px solid #C7D2FE" }}>{myChannelsVideos.length} vídeos</span>
                    </div>

                    {/* Sort bar */}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:18, padding:"12px 14px", background:"var(--surface2)", borderRadius:12, border:"1px solid var(--border)" }}>
                      <span style={{ fontSize:12, fontWeight:700, color:"var(--t3)", alignSelf:"center", marginRight:4 }}>Ordenar por:</span>
                      {SORT_OPTIONS.map(opt => {
                        const active = myChannelsSortMetrics.includes(opt.key);
                        return (
                          <button key={opt.key} title={opt.desc}
                            onClick={() => setMyChannelsSortMetrics(prev => active ? prev.filter(k => k !== opt.key) : [...prev, opt.key])}
                            style={{ padding:"5px 14px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer", transition:"all 0.15s", border:active?"1.5px solid #6366F1":"1.5px solid var(--border)", background:active?"#6366F1":"var(--surface)", color:active?"#fff":"var(--t2)" }}>
                            {myChannelsSortMetrics.indexOf(opt.key) >= 0 ? `${myChannelsSortMetrics.indexOf(opt.key)+1}. ${opt.label}` : opt.label}
                          </button>
                        );
                      })}
                      {myChannelsSortMetrics.length > 0 && (
                        <button onClick={() => setMyChannelsSortMetrics([])}
                          style={{ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"1.5px solid var(--border)", background:"transparent", color:"var(--t4)" }}>
                          Resetar
                        </button>
                      )}
                    </div>

                    <div className="video-grid">
                      {(sortedMyChannelsVideos || myChannelsVideos).map((video, i) => (
                        <VideoCard
                          key={video.videoId + i}
                          video={video} index={i} rank={i+1}
                          onReportClick={setReportVideo}
                          onFollowToggle={openFollowModal}
                          isFollowed={followedChannels.some(c => c.channelId === video.channelId)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
