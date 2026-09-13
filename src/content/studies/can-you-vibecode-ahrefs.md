---
title: "Can you vibecode Ahrefs?"
standfirst: "I gave an AI coding agent one prompt and six hours: rebuild the three things I pay Ahrefs for, from public data only. All three ran after 16 minutes. Here's what each one had inside."
verdict: "no"
verdict_text: ""
opener: ""
cover_figure:
  src: "/studies/ahrefs/fig1a.webp"
  alt: "Ahrefs Site Explorer overview for canivibecodeit.com on 9 September 2026: domain rating 34, 9.5K backlinks, 346 referring domains, 461 all time, with the last month's changes shown as plus 23, plus 9.2K and plus 109."
  caption: "Left, Ahrefs: 346 referring domains for my site, 9,500 backlinks. Right, the clone: 5."
  pair:
    src: "/studies/ahrefs/fig1b.webp"
    alt: "The vibehrefs clone's Site Explorer screen for canivibecodeit.com. Five referring domains from the Common Crawl graph. Domain rating, backlinks, organic keywords and organic traffic all read not available."
row_figures:
  - src: "/studies/ahrefs/fig2a.webp"
    alt: "Ahrefs Keywords Explorer overview for the keyword vibe coding, United States: keyword difficulty 2, search volume 87K, global volume 286K, traffic potential 34K, first seen February 2025, with 11,162 matching keyword ideas."
    caption: "Left, Ahrefs: 87,000 searches a month, difficulty 2, 11,162 ideas. Right, the clone: volume not available, 328 ideas."
    pair:
      src: "/studies/ahrefs/fig2b.webp"
      alt: "The clone's Keywords Explorer screen for the keyword vibe coding. Monthly search volume, global volume, traffic potential and CPC all read not available. A Google Trends line and Bing's top ten sit below."
  - src: "/studies/ahrefs/fig3.webp"
    alt: "The clone's Rank Tracker screen for canivibecodeit.com with ten keywords. Every keyword shows not in top ten. Positions one to three and four to ten both read zero."
    caption: "The clone: 0 of 10 keywords in Bing's top ten."
cards:
  eyebrow: "The part nobody prices in"
  title: "Letting AI do it cuts both ways."
  intro: "The agent that built my clone in 16 minutes is the same kind of agent Ahrefs now runs on fifteen years of its own data. Two of these cards are good news for Ahrefs, and the third explains how the same agents make leaving Ahrefs easier."
  items:
    - label: "The clone's ceiling"
      title: "The screens were up after 16 minutes, and the data behind them was still missing when the agent stopped at minute 54."
      body: "The clone found 5 referring domains for this site where Ahrefs shows 346, couldn't produce a search volume for any keyword, and ranked 0 of 10 keywords because no search engine would answer a server."
    - label: "Letaido, the moat at work"
      title: "Ahrefs put its agent on the one input a clone cannot generate."
      body: "Letaido reads the Ahrefs index directly and writes the report for you, for $99 a month. Once an agent builds the dashboard on demand, the only thing left with a price is what the agent reads."
      accent: true
    - label: "The other edge"
      title: "An agent between you and the interface makes leaving easier."
      body: "Years of muscle memory in Site Explorer keep people paying, and an agent that answers for you makes that habit matter less, so if the data ever stops being the best, Letaido lowers the cost of walking away."
charts:
  - id: "cost"
    type: "columns"
    title: "What one person pays a month"
    note: "What one person pays a month: $0 to build it, Ahrefs from $29 with Lite at $129, $99 for the agent."
    alt: "Column chart of monthly cost for one person: build it yourself at zero dollars, buy Ahrefs with marks at 29, 129, 249 and 449 dollars and the 129 dollar Lite plan filled, and the vendor's agent at 99 dollars with a marker for an Ahrefs plan on top."
    prefix: "$"
    max: 500
    step: 100
    columns:
      - label: "build it yourself"
        bar:
          value: 0
          label: "$0"
      - label: "buy Ahrefs"
        marks:
          - value: 29
            label: "$29"
          - value: 129
            label: "Lite $129"
            accent: true
          - value: 249
            label: "$249"
          - value: 449
            label: "$449"
      - label: "let the vendor's agent do it"
        bar:
          value: 99
          label: "$99"
          accent: true
        marks:
          - value: 99
            label: "+ an Ahrefs plan"
            above: true
footer_line: "Commissioned by Ahrefs and written by me: they paid for the question and had no say in the answer. If it had come back yes, clone it, that's what you would be reading, and that's the only reason this study is worth anything."
contents:
  - "What one prompt and six hours actually built of Ahrefs, and where each tool stopped"
  - "The index is the product, and time is the part no prompt can make"
  - "The honest part: what's one prompt away, and what that means for the tiers"
  - "Ahrefs against every tag in the site's taxonomy, with the dataset's number for each"
  - "Build it, buy it, or let the vendor's agent do it, priced per month"
  - "What happens when the vendor puts an agent on its own data"
  - "Three things for anyone deciding what to clone and what to pay for"
---

## 1. The weekend clone test

One prompt: build me the three things I pay Ahrefs for, using only public or free data, a backlink checker, a keyword explorer with volume and difficulty, and a rank tracker.

Six hours, no paid data, no scraping Google, and one rule above the rest: never fake a number.

**All three tools were running after 16 minutes.**

The agent filed its report at minute 38 and stopped at minute 54 of the 360 it had, which anyone selling a dashboard should sit with.

Then it hit three walls.

**1. Backlinks.** It downloaded Common Crawl's web graph, 12.7 gigabytes, 2.45 billion links between 119.7 million domains. It scanned the lot in five minutes.

Referring domains for canivibecodeit.com, according to the clone: 5.

Ahrefs, on 9 September, showed 346.

It found a linking page with a date for two of the five, and the other three say "unknown". A new edition of the free graph lands about monthly, each covering the previous three months of crawls; the clone's covers June to August 2026.

**2. Volume.** The keyword explorer pulled 328 related phrases for "vibe coding" out of autocomplete in under a minute.

Monthly search volume: "not available", in red, because no free source for that number exists.

Ahrefs' answer for the same keyword, on my account: 87,000 searches a month in the US, difficulty 2, and 11,162 keyword ideas to the clone's 328.

The clone's difficulty score is arithmetic over a Bing results page served to a bot, which makes it a real number about the wrong thing. For "calendly alternatives" that proxy said 23; Ahrefs says 3.

Here are the three keywords side by side in Ahrefs:

![Ahrefs Keywords Explorer table for three keywords in the United States: vibe coding, difficulty 2, volume 87K, first seen 2 February 2025; calendly alternatives, difficulty 3, volume 1.6K, first seen 28 December 2015; granola pricing, difficulty 13, volume 500, first seen 10 October 2017.](/studies/ahrefs/fig13.webp "Ahrefs: difficulty 2, 3 and 13; volumes 87,000, 1,600 and 500; first seen 2015, 2017 and 2025.")

**3. Rankings.** Every search engine the clone tried put up a CAPTCHA: DuckDuckGo, Brave, Mojeek, Qwant, Yandex. Google was off limits by rule.

Bing answered, and its answer to "can i vibecode it" was six dictionary entries for the word "can".

I suppose that's technically a result.

The tracker shows 0 of 10 keywords ranking, because the search results, the only input that mattered, were the input it couldn't get.

This is what the walls looked like:

![DuckDuckGo's picture CAPTCHA page as served to the clone's server, reading unfortunately bots use DuckDuckGo too.](/studies/ahrefs/fig4.webp "Left: DuckDuckGo's CAPTCHA to the clone's server. Right: Bing's first page for \"can i vibecode it\", six dictionary entries.") ![Bing's first page of results for the query can i vibecode it, showing dictionary entries for the word can.](/studies/ahrefs/fig5.webp)

The agent's own verdict: what Ahrefs sells is the crawler and the years of stored first-seen dates, "and none of that was reachable from here in six hours or would be in six months."

So what exactly is on the other side of that wall?

## 2. The data wall

Numbers, from Ahrefs' own page, as I read it on 7 September 2026.

Pages in the index: 493.9 billion.

External backlinks: 3 trillion in the live index, 35 trillion in the historical record.

Domains: 209.5 million.

Fifteen years of crawling sit behind those numbers. The backlink index refreshes every 15 to 30 minutes, which takes a crawler doing 5 million pages a minute and hardware they say would cost $900 million over three years to rent.

Here's the page:

![The numbers block on Ahrefs' big data page: 35 trillion external backlinks in history, 493.9 billion pages in the index, 28.7 billion keywords, 16 years of historical data.](/studies/ahrefs/fig7.webp "ahrefs.com/big-data, as published on 7 September 2026.")

The clone had Common Crawl, the best free web graph there is: 119.7 million domains, 2.45 billion links.

Who links to canivibecodeit.com?

The clone: 5 domains.

Ahrefs, on the same day: 346, with 9,500 backlinks behind them.

It could name a linking page and a date for two of the five, and only after the Common Crawl index server had refused the connection for 26 minutes.

Ahrefs' screen also shows the last month on its own: 109 new referring domains and 9,200 new links, arriving after the free graph's edition had already closed. The clone saw nothing of it.

Now ahrefs.com itself.

The free graph finds 116,776 referring domains. Ahrefs' own live count for its own site is 113,000, with 353,000 all time.

**For a domain that size, the free graph gets the headline count right.**

What it can't give you: the 26.6 million backlinks behind that count, the pages and dates, a domain rating, and a number that moves every fifteen minutes.

Both screens, side by side:

![Ahrefs Site Explorer overview for ahrefs.com on 9 September 2026: domain rating 91, 26.6M backlinks, 319M all time, 113K referring domains, 353K all time, 38.6K organic keywords, 4M organic traffic.](/studies/ahrefs/fig6a.webp "Left, Ahrefs on ahrefs.com: 113,000 referring domains, 26.6 million backlinks. Right, the clone: 116,776 referring domains, no backlinks, pages or dates.") ![The clone's Site Explorer screen for ahrefs.com: 116,776 referring domains from the Common Crawl graph, top referrers google.com, linkedin.com and cloudflare.com, with no page-level backlinks or dates.](/studies/ahrefs/fig6b.webp)

Three sites, side by side:

My six-week-old site: 5 against 346.

My other product, superx.so: 299 against 2,300.

Ahrefs itself: 116,776 against 113,000.

The free graph gets the giant right and misses almost everything about the small ones, and small is where everyone starts.

![Ahrefs Site Explorer overview for superx.so on 9 September 2026: domain rating 50, 22.6K backlinks, 2.3K referring domains, 3.3K all time, 1.8K organic traffic.](/studies/ahrefs/fig14a.webp "Left, Ahrefs: 2,300 referring domains for superx.so. Right, the clone: 299, no pages, no dates.") ![The clone's Site Explorer screen for superx.so: 299 referring domains from the Common Crawl graph, zero linking pages and dates because the Common Crawl index server rate-limited every query.](/studies/ahrefs/fig14b.webp)

**What Ahrefs sells is the database, because the search box on top of it took the agent 16 minutes to rebuild.**

Keywords have the same shape: 28.7 billion of them across 217 locations, each with a volume history.

The free path gets you Google Trends, a 0 to 100 relative index and no volume at all, and there's no public copy of a volume database.

The newest wall is eighteen months old. Brand Radar runs more than 459 million prompts a month through six AI answer engines and keeps every response, with history that its own page says goes back to 2025.

I pointed it at this site, which is six weeks old. Share of AI answers: 0%, sixth of six in the competitor set it picked, 87 mentions on the web.

Then I pointed it at Ahrefs: 17%, 61,300 AI mentions.

![Ahrefs Brand Radar overview for canivibecodeit: AI share of voice 0%, ranked sixth among six competitors, search demand 160 last month, web visibility 87 mentions, YouTube 0.](/studies/ahrefs/fig8.webp "Left, Brand Radar overview for canivibecodeit: 0% share of AI answers, sixth of six. Right, AI responses: 107,480 in the set, 0 mentioning the site.") ![Ahrefs Brand Radar AI responses view for canivibecodeit: 107,480 AI responses in the competitor set, none mentioning the site.](/studies/ahrefs/fig9.webp)

![Ahrefs Brand Radar overview for Ahrefs: AI share of voice 17%, ranked third among competitors, 61.3K AI mentions, search demand 2.8M, web visibility 4.7M, YouTube 771.](/studies/ahrefs/fig10.webp "Left, Brand Radar overview for Ahrefs: 17% share of AI answers, 61,300 mentions. Right, AI responses: 346,379 in the set, including \"what are the best Ahrefs alternatives?\" answered with Ahrefs first.") ![Ahrefs Brand Radar AI responses view for Ahrefs: 346,379 AI responses in the set, including a live answer to the prompt What are the best Ahrefs alternatives, which names Ahrefs first.](/studies/ahrefs/fig11.webp)

Nobody can go back and collect 2025.

So is there anything left that a weekend actually buys you?

## 3. Where the moat isn't

Plenty, and this is the part Ahrefs didn't pay for and gets anyway, because a study that only finds moats is an advert.

**The interface.** The agent rebuilt three of Ahrefs' screens in under an hour, and once it had their product pages to copy from, they looked like Ahrefs. Nobody pays $129 a month for the layout of a table.

**The plumbing.** Rank tracking is a keyword list and a scheduled job, twenty minutes of work.

Add a SERP API key, the kind the site's own Ahrefs prompt recommends, and it fills with real Google positions for your own domain. The clone's job is set to run daily; we didn't wait a day to watch it.

Ahrefs' Rank Tracker updates weekly on all four plans, Enterprise included. For one site you own, the weekend version can check more often than Ahrefs does.

The agent couldn't sign up for that key from a server, which anyone with a browser can.

**Site audits.** Crawl your own domain and write what's broken to a file. Ahrefs knows this, which is why it gives that away in [Ahrefs Free](https://ahrefs.com/free).

**Keyword ideas.** The agent pulled 328 real phrases for "vibe coding" in a minute, at no cost. That was the one tool it said it would keep.

Ahrefs lists 11,162 for the same seed, with a volume against each one. Ahrefs charges for that number, and the list comes free with it.

Ahrefs is a thin layer of software over a dataset that took fifteen years to collect, and the tiers price the dataset.

If you only ever look at your own site, [Ahrefs Free](https://ahrefs.com/free) plus a weekend covers you, and Ahrefs' own pricing page more or less says so; type in a domain you don't own and you're back at chapter 2.

![Diagram of a thin dashboard panel resting on a thick stack of data layers labelled 15 years of crawl data, with a bracket marking the panel as one weekend.](/studies/ahrefs/fig15.webp "A thin layer of software on top of fifteen years of data.")

How does that hold up against every other app on this site?

## 4. Scored against the 13 moat types

Every app on this site carries one to three moat tags, strongest first. A tag answers one question: why do people still pay for this instead of building it?

Ahrefs carries two: proprietary data, then infrastructure scale.

The chart at the top of this page draws all 13 live, with Ahrefs' two tags picked out. Here's the table behind it, 1,093 apps as of this week. "Held" means the app kept a not-really verdict.

| moat tag | apps tagged | held (not really) | one of Ahrefs' moats? |
|---|---:|---:|---|
| marketplace liquidity | 10 | 90% | no |
| brand and trust | 99 | 69% | partly |
| proprietary models | 133 | 68% | no |
| compliance and regulation | 122 | 67% | no |
| network effects | 90 | 67% | no |
| **proprietary data** | 134 | **56%** | **yes, first tag** |
| infrastructure scale | 465 | 52% | **yes, second tag** |
| content and rights | 112 | 46% | no |
| switching costs | 63 | 32% | partly |
| integrations | 448 | 29% | partly |
| hardware | 8 | 25% | no |
| collaboration | 181 | 18% | partly |
| execution polish | 612 | 17% | yes, like everyone |

[pull: Apps carrying both of Ahrefs' tags together hold at 74%, 35 of 47. | THE NUMBER]

Proprietary data on its own is mid-table, holding a not-really verdict 56% of the time.

Thirteen apps with that tag got a straight yes, because their "data" turned out to be a template library or a list you could scrape in an afternoon. The tag only bites when the data is too big to rebuild, and that's a scale question.

Apps carrying both of Ahrefs' tags together hold at 74%, 35 of 47.

The pair is the moat: a crawler that has been running for years, and the storage to keep what it found.

Then look at what Ahrefs doesn't have: network effects (your account isn't better because mine exists), a marketplace, or a regulator standing behind it.

Switching costs are modest because the reports export, and integrations and collaboration are there but nobody pays for them.

Strip all that away and Ahrefs is defended by one thing, which this dataset says holds best at scale.

What does that one thing cost, and what does the alternative cost?

## 5. The "let AI do" economics

Three ways to get what Ahrefs does, priced per month for one person.

[chart: cost]

| | build it yourself | buy ahrefs | let the vendor's agent do it |
|---|---|---|---|
| upfront | one weekend of prompting | 0 | 0 |
| per month | $0. no keys, no paid sources; a 12.7 GB download whenever you want a fresher edition (a new one lands about monthly) | $29 Starter, $129 Lite, $249 Standard, $449 Advanced¹ | $99 flat, with $50 of AI credits included; an Ahrefs plan on top if you want it reading your full data² |
| what you get | a rank tracker and a site audit for your own domain, with a dashboard on top | the index: backlinks, volumes, difficulty, history, for any domain | the index plus the analysis written for you |
| what you don't get | anyone else's data. volume and difficulty numbers you can defend | your time back | the dashboard. it builds one for you, but you're not the one holding it |
| time to first answer | 16 minutes to a running tool. for volume or rankings, never | minutes | 2 minutes, $0.77 of the included credits |

¹ ahrefs.com/pricing in USD, monthly billing, seen 7 Sep 2026. Annual billing is $1,290, $2,490 and $4,490 a year, which Ahrefs shows as $108, $208 and $374 a month. Enterprise is $1,499 a month on an annual contract. Ahrefs Free exists for sites you own. Ahrefs' own Starter plan page, seen 11 Sep 2026, puts Site Explorer, Keywords Explorer, Site Audit and Rank Tracker on the $29 plan, capped at 200 credits a month, 250 rows a report, one month of history and 50 tracked keywords.

² letaido.com/#pricing and docs.letaido.com/docs/pricing, seen 7 Sep 2026. Their docs: the agent's read access mirrors your Ahrefs plan's limits; a free Ahrefs account works but pulls only what a free plan can.

[pull: From $29 a month you rent a crawl that started before you needed it. | THE PRICE]

**The dashboard is the cheap part.**

For your own site, $0 a month buys you a working rank tracker and audit, so if that's you, build it: Search Console costs nothing and the clone took one weekend of prompting.

Type in a domain you don't own and the price of the free path goes to infinity.

There's no public source for who links to a competitor, and no free monthly volume you can trust; difficulty falls with them.

The clone didn't find a cheaper way to get that data, because there's none.

From $29 a month you rent a crawl that started before you needed it.

Starter at $29 is the cheapest way in. It opens Site Explorer and Rank Tracker on any domain, with 250 rows a report, one month of history and 50 tracked keywords.

Lite at $129 is the plan you'd actually work on, because it lifts those to 2,500 rows, six months of history and 750 keywords.

For $99 a month you get an agent that reads the index directly and builds the report, and the docs are blunt that it reads exactly what your Ahrefs plan lets it read.

That's a way to stop building the dashboard at all.

Which brings me to the card I cut from the mockup.

## 6. Letaido: the moat at work

The mockup for this study had a card that read "the moat, weaponized". I cut it because it sounded like a pitch deck, and then I read what Letaido actually is.

It's an agent, built by Ahrefs, that reads every Ahrefs report directly, "including data you cannot reach via the Ahrefs API or MCP" in their words, and builds the report or tool you asked for.

![Diagram of an agent sitting on top of a thick stack of data layers labelled 15 years of crawl data, with a browser window and a clock beside it and the labels the agent and runs every day.](/studies/ahrefs/fig18.webp "An agent working on top of the index, on a schedule.")

The price is $99 a month, $50 of model credits included, and it reads exactly what your Ahrefs plan lets it read.

Put that next to chapter 1, where the clone spent its 54 minutes building screens.

Once an agent writes the dashboard on demand, the dashboard has no price, and the only thing left with a price is what the agent reads.

**Ahrefs put its agent on the one input a vibecoded rival cannot generate.**

It cuts the other way too.

An agent between you and the interface makes the interface stop being a reason to stay. Years of muscle memory in Site Explorer keep people paying; ask the agent instead and that habit stops mattering.

If Ahrefs' data ever stops being the best, Letaido makes leaving easier, so the moat is the index and Letaido is a bet that the index is enough.

Then I pointed it at this site.

The prompt was: audit canivibecodeit.com and tell me the five keywords I should target next, with volume.

It answered in two minutes.

![Letaido answering the audit prompt for canivibecodeit.com](/studies/ahrefs/fig12.webp "The agent, two minutes and 77 cents in: five keywords with volume, difficulty and a reason.")

It opened by telling me it already had a month of Ahrefs research on this domain on file, so it audited against that and spent nothing on fresh calls.

Five keywords came back, all the same shape: heygen pricing, clickup pricing, descript pricing, synthesia pricing and jotform pricing.

Together they carry about 26,000 US searches a month at an average difficulty of 7, and not one of them has a page on this site yet.

Then it explained why it had gone to pricing pages at all.

Across the 990 apps it had numbers for, "[app] pricing" carries 633,590 US searches a month.

"[app] alternatives", the phrase this whole site is built around, carries 141,810.

Pricing also wins head to head on 719 of those 990 apps, which I didn't know and wouldn't have thought to check.

Its last suggestion was to fold "is [app] free" into those same pages, a family worth 210,170 US searches a month that nothing here targets today.

The whole run cost $0.77 of the $50 of credits that come with the $99 a month.

Yes, because you're paying for the data. The $99 is Ahrefs' index with an agent sitting on it, and $50 of that comes straight back as credits.

So what do you do with all this if you're building?

## 7. What this means if you're building

Three things follow.

![Two-branch decision tree whose root asks whether the value is in the software or in the data, with the software branch reading vibecode it and the data branch reading buy it or build on it.](/studies/ahrefs/fig19.webp "One question decides what to build.")

**1. Rent the data and build the layer on top.** If the value you want is in the software, a weekend gets you the software; the clone's rank tracker plumbing took twenty minutes. What nobody builds in a weekend is a fact about the world that took years to collect. Find out early which of those your idea depends on, and price them. Ahrefs sells its fact from $29 a month, which is cheap next to a crawler, and it sells the same data by API and [MCP](https://ahrefs.com/mcp) if you want it inside your own build.

**2. Check the moat before the feature list.** Of 1,093 apps on this site, 612 lean on execution polish, and polish holds a not-really verdict 17% of the time. Proprietary data with infrastructure scale behind it holds 74%, so the polish is what to clone and the data is what to build a business on.

**3. Assume the incumbent gets the same agents you do.** The tools that let you rebuild a dashboard in an afternoon are the tools Ahrefs is pointing at its own index. A product defended only by "nobody has built the interface yet" is undefended, while fifteen years of crawling is a fifteen-year head start that agents don't shorten.

## How this was scored

The dataset is the public canivibecodeit.com app list, 1,093 apps on the day of writing, each with a verdict (yes, kinda, not really) and one to three moat tags from a fixed list of 13, defined in the repo and on /moats. "Held" in the chapter 4 table is the share of apps with that tag whose verdict is not really.

The clone was one AI coding agent session, one prompt, a six-hour limit, public and free data only, no scraping of Google results, no paid SEO API. Its [report](/studies/can-you-vibecode-ahrefs/files/clone-report.md) and [log](/studies/can-you-vibecode-ahrefs/files/clone-log.md) are published alongside this study, unedited apart from removing server paths, and the app itself (we called it vibehrefs) is kept in a private repo.

Every Ahrefs number in this study comes from a screenshot taken on my own paid account or from a page Ahrefs publishes, read on 7 September 2026. The index figures are as published on ahrefs.com/big-data on that day; the page itself carries no date on those numbers. Ahrefs prints three versions of the Brand Radar prompt figure on 9 September 2026: 459M+ on the Brand Radar page, 460M on the numbers page and 475M+ on the pricing page. We use the product page's.

"Fifteen years of crawling" is Ahrefs' own phrase on ahrefs.com/about; its numbers page says 16 years of historical data. The agent covered in chapter 6 is called Letaido.

Ahrefs read the draft for factual errors before publication. They didn't see the verdict before we wrote it and they had no say in it.
