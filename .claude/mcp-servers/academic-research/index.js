#!/usr/bin/env node
// Local MCP server wrapping the public Semantic Scholar Academic Graph API
// and the arXiv API. No API key required. Used to research faculty
// publications and research fit when drafting per-program SOPs.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { XMLParser } from "fast-xml-parser";

const USER_AGENT = "masters-application-research-mcp/1.0 (personal, non-commercial)";

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function textContent(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

const TOOLS = [
  {
    name: "search_semantic_scholar",
    description:
      "Search Semantic Scholar for papers by keyword/topic. Returns title, authors, year, venue, abstract, and URL. Useful for finding recent work in a research area.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. 'graph neural networks for drug discovery'" },
        limit: { type: "number", description: "Max results (default 10, max 50)", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "search_semantic_scholar_author",
    description:
      "Look up a researcher/professor by name on Semantic Scholar and list their recent papers. Useful for checking a faculty member's current research focus before writing an SOP.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Author's full name, e.g. 'Jane Smith'" },
        paperLimit: { type: "number", description: "Max papers to return per matched author (default 10)", default: 10 },
      },
      required: ["name"],
    },
  },
  {
    name: "search_arxiv",
    description:
      "Search arXiv for preprints by keyword/topic. Returns title, authors, summary, published date, and link.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. 'quantum error correction'" },
        maxResults: { type: "number", description: "Max results (default 10, max 50)", default: 10 },
      },
      required: ["query"],
    },
  },
];

async function searchSemanticScholar({ query, limit = 10 }) {
  const capped = Math.min(Math.max(1, limit), 50);
  const fields = "title,abstract,year,authors,venue,url,externalIds";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${capped}&fields=${fields}`;
  const data = await fetchJson(url);
  return {
    total: data.total ?? null,
    papers: (data.data ?? []).map((p) => ({
      title: p.title,
      year: p.year,
      venue: p.venue,
      authors: (p.authors ?? []).map((a) => a.name),
      abstract: p.abstract,
      url: p.url,
      doi: p.externalIds?.DOI,
    })),
  };
}

async function searchSemanticScholarAuthor({ name, paperLimit = 10 }) {
  const authorSearchUrl = `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(
    name
  )}&fields=name,affiliations,paperCount,hIndex`;
  const authorData = await fetchJson(authorSearchUrl);
  const authors = authorData.data ?? [];
  if (authors.length === 0) {
    return { matches: [] };
  }

  const capped = Math.min(Math.max(1, paperLimit), 50);
  const matches = [];
  for (const author of authors.slice(0, 3)) {
    const papersUrl = `https://api.semanticscholar.org/graph/v1/author/${author.authorId}/papers?fields=title,year,venue,abstract,url&limit=${capped}`;
    const papersData = await fetchJson(papersUrl);
    matches.push({
      name: author.name,
      affiliations: author.affiliations,
      hIndex: author.hIndex,
      paperCount: author.paperCount,
      recentPapers: (papersData.data ?? [])
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        .map((p) => ({ title: p.title, year: p.year, venue: p.venue, abstract: p.abstract, url: p.url })),
    });
  }
  return { matches };
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

async function searchArxiv({ query, maxResults = 10 }) {
  const capped = Math.min(Math.max(1, maxResults), 50);
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
    query
  )}&start=0&max_results=${capped}`;
  const xml = await fetchText(url);
  const parsed = xmlParser.parse(xml);
  const entries = parsed?.feed?.entry;
  const list = entries ? (Array.isArray(entries) ? entries : [entries]) : [];
  return {
    papers: list.map((e) => {
      const authors = e.author ? (Array.isArray(e.author) ? e.author : [e.author]) : [];
      const links = e.link ? (Array.isArray(e.link) ? e.link : [e.link]) : [];
      const htmlLink = links.find((l) => l["@_type"] === "text/html")?.["@_href"] ?? e.id;
      return {
        title: typeof e.title === "string" ? e.title.replace(/\s+/g, " ").trim() : e.title,
        authors: authors.map((a) => a.name),
        summary: typeof e.summary === "string" ? e.summary.replace(/\s+/g, " ").trim() : e.summary,
        published: e.published,
        url: htmlLink,
      };
    }),
  };
}

const server = new Server(
  { name: "academic-research", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "search_semantic_scholar":
        return textContent(await searchSemanticScholar(args ?? {}));
      case "search_semantic_scholar_author":
        return textContent(await searchSemanticScholarAuthor(args ?? {}));
      case "search_arxiv":
        return textContent(await searchArxiv(args ?? {}));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error calling ${name}: ${err.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
