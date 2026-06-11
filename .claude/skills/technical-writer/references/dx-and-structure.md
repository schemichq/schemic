# Developer experience, structure, and code samples

Documentation is a product, and its UX is measured in how fast a reader reaches
their goal and how rarely they get stuck. Optimize the experience, not just the
prose.

## Time-to-first-success

The single most important metric for developer docs is how long it takes a new
reader to get *something* working — install and a first real result.

- **Front-load the win.** The smallest end-to-end example should appear early,
  not after pages of concepts. Concepts land better once the reader has seen it
  work.
- **Remove every avoidable step** from the path to first success. Each
  prerequisite, signup, or config file is a place to lose people.
- **State prerequisites explicitly and exactly** before the steps: versions,
  accounts, installed tools. A reader who fails on step 4 because of a missing
  prerequisite blames the docs.
- **Make the first example real,** not `foo`/`bar`. Readers copy the first thing
  that works and build on it.

## Information architecture

- **Organize by the reader's task, not your code's structure.** Module boundaries
  are for maintainers; readers navigate by what they're trying to do.
- **Progressive disclosure.** Landing → getting started → guides → reference →
  deep explanation. Each layer assumes the one before and links down for detail.
- **Predictable, shallow navigation.** A reader should guess where a topic lives.
  Prefer a flat, well-named structure over deep nesting.
- **One canonical home per topic.** Duplicated explanations drift out of sync;
  link to the canonical one instead of restating it.
- **No dead ends.** Every page ends by pointing somewhere sensible: the next step,
  related how-tos, the reference for full options.

## Scannability

Developers scan before they read.

- Descriptive headings that work as a table of contents on their own.
- Short paragraphs; whitespace is a feature.
- Lists and tables for parallel or structured information.
- Callouts (note / warning / tip) for genuine asides — used sparingly, or they
  become noise. A warning the reader must not miss should be impossible to miss.
- Put the key fact at the start of the line/row, not buried mid-sentence.

## Code samples

Code is the part readers trust most and copy first. Treat it as the highest-stakes
content on the page.

- **Runnable and complete enough to work.** If a reader copies it, it should run
  (or the prose must say exactly what to substitute). Prefer examples verified
  against the real API — never invent output.
- **Minimal.** Show only what the point requires. Strip unrelated imports,
  error handling, and config that distracts from the idea being taught.
- **Build up progressively.** Start with the smallest version; add one concern at
  a time across examples rather than presenting one wall of code.
- **Show the output.** What the reader should see — a return value, a log line,
  the generated DDL — so they can confirm success and recognize failure.
- **Highlight the relevant line** when the surrounding code is setup, so the eye
  goes to what matters.
- **Use realistic, consistent values.** Reuse the same example domain across a
  doc set; switching domains every example makes readers re-anchor each time.
- **Make it copy-pasteable.** No leading prompts (`$`) mixed into copyable code,
  no line numbers baked into the text, no "…" the reader has to fill silently.

## Errors and recovery

- **Document the failure modes,** not only the happy path. The reader most in need
  of docs is the one who hit an error.
- **Make error messages searchable:** quote the exact text so a reader pasting it
  into search lands on your page.
- **Map error → cause → fix.** A short troubleshooting table earns its keep.

## Accuracy over time

- **Examples rot.** Prefer samples that can be tested/compiled so they fail loudly
  when the API changes.
- **Pin versions** where behavior depends on them, and say which version the page
  describes — especially the SurrealDB server version, since SurrealQL differs
  across majors.
- **Date or version time-sensitive claims** ("as of v3.1"). Undated claims
  silently become wrong — and surreal-zod is pre-1.0, so they will.

## Accessibility and inclusivity

- Real heading hierarchy (don't fake headings with bold); screen readers and
  outlines depend on it.
- Alt text for images that carry meaning; never put information *only* in an image.
- Don't rely on color alone to convey meaning.
- Plain language helps non-native readers as much as beginners — it's the same win.
