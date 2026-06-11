# Voice, style, and editing

Concrete, enforceable rules. When a rule and clarity conflict, clarity wins —
but know the rule before you break it.

## Voice and tense

- **Active voice.** "The server validates the token," not "the token is validated
  by the server." Passive hides who acts; in docs the actor matters.
- **Present tense.** "`encode` returns a payload," not "will return."
- **Second person.** Address the reader as "you." Use "we" only in tutorials where
  you're doing something together. Avoid "the user" when you mean "you."
- **Imperative for steps.** "Run the migration," not "You should run the migration"
  or "The migration can be run."

## Structure of a sentence and a paragraph

- **Lead with the point.** Conclusion first, support after. This holds at every
  level: the document, the section, the paragraph, the sentence.
- **One idea per paragraph**, one main idea per sentence. Break compound sentences
  that hide a second thought in a subordinate clause.
- **Short sentences for hard ideas.** When the concept is complex, the prose
  should be simple. Don't stack difficulty on difficulty.
- **Parallel structure** in lists and headings: same grammatical form throughout.

## Word choice

- **Cut filler and throat-clearing:** "It's worth noting that," "Basically,"
  "In order to" (→ "to"), "At this point in time" (→ "now"), "Due to the fact
  that" (→ "because").
- **Cut hedges and weasel words** unless the uncertainty is real and load-bearing:
  "perhaps," "somewhat," "it seems," "generally." If it's true, say it plainly.
- **Cut self-deprecating belittling:** "simply," "just," "easy," "obviously,"
  "of course." They shame the stuck reader and add nothing.
- **Cut marketing:** "powerful," "seamless," "blazing fast," "robust,"
  "world-class." Show the capability; don't claim the adjective.
- **Be specific.** "Returns quickly" → "returns in under 10 ms for typical inputs."
  Replace vague quantifiers with numbers when you have them.

## Terminology

- **Define jargon on first use,** then use it consistently. Don't alternate
  between synonyms for the same concept — "field," "column," and "attribute" for
  the same thing forces the reader to check whether you mean three things.
- **Pick one name per concept** and put it in a glossary if the set is large.
- **Match the audience's vocabulary,** not the implementation's. Readers search
  for the words they know.

## Lists, tables, and headings

- **Lists** for parallel items or sequential steps. Numbered when order matters,
  bulleted when it doesn't. Keep items grammatically parallel.
- **Tables** for facts with consistent dimensions (parameters, options,
  comparisons). Not for prose.
- **Headings describe content, not labels.** "Configuring retries" beats
  "Configuration." A reader should navigate by scanning headings alone.
- **Don't skip heading levels;** keep the hierarchy meaningful for screen readers
  and outline generators.

## Links

- **Descriptive link text.** Link the words that name the destination, never
  "click here" or "this." "See the [migration guide]" — the linked words tell the
  reader and the search engine where they're going.
- **Link the first mention** of a concept defined elsewhere; don't re-link every
  occurrence.

## Code in prose

- Wrap identifiers, commands, paths, and values in `code formatting`.
- Quote exact output and error strings so readers can match and search them.
- Keep inline code short; anything multi-line belongs in a block. (Sample design
  lives in `dx-and-structure.md`.)

## Editing discipline

When revising someone else's (or your earlier) text:

1. **Read it whole first.** Understand the audience, purpose, and doc type before
   changing a word. Often the prose has drifted between doc types — that's the
   real fix.
2. **Preserve meaning.** Tighten and clarify; don't alter claims or scope. If a
   statement looks factually wrong, flag it for the user rather than silently
   rewriting — you may be missing context.
3. **Subtract before you add.** Most weak docs are too long, not too short.
4. **Keep the author's voice** unless asked to change it. Edit for clarity, not to
   sound like you.
5. **Surface substantive changes** so the user can review them, especially
   anything touching meaning.

## Before you ship — self-review checklist

Run this before declaring any piece done:

- [ ] **Scope and doc type** are clear and consistent throughout — no mixing of
      types on one page.
- [ ] The reader can **act** after reading: the promised outcome is achievable.
- [ ] **First screen earns attention:** the point, not preamble.
- [ ] Every **example is correct and runnable** — verified against the source, not
      invented; `encode`/`decode` and wire/app are not swapped.
- [ ] **No filler, hedges, marketing, or "just/simply."**
- [ ] **Headings are descriptive** and the page is navigable by scanning them.
- [ ] **Terms are consistent;** SurrealQL jargon defined on first use.
- [ ] **Link text is descriptive;** links resolve.
- [ ] There's a **clear next step** — no dead end.
- [ ] Read it **out loud** (or imagine it): sentences that trip the tongue trip
      the reader.
