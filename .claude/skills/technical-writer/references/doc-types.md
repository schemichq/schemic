# Doc types (Diátaxis)

Four kinds of documentation serve four different reader needs. They are not
stylistic choices — they are different documents with different rules. The
single biggest quality failure in technical docs is mixing them on one page: a
tutorial that stops to explain architecture, a reference page that editorializes,
a how-to that teaches concepts. Separate them.

## Which one do I need?

Ask what the reader is doing right now:

- **Learning the tool for the first time, hands on the keyboard** → Tutorial
- **Has a specific goal and knows roughly what they're doing** → How-to
- **Needs to look up a precise fact** (a signature, a flag, a default) → Reference
- **Wants to understand why it works this way, or to decide** → Explanation

If two of these are true at once, you have two documents. Write both and link them.

---

## Tutorial — learning-oriented

**Reader:** a beginner who wants to learn by doing. They don't yet know what
questions to ask. **Your promise:** if they follow along, it works.

Rules:
- One happy path. No "you could also…", no choices, no alternatives.
- Guarantee success at every step. Pin versions, give exact commands, show exact
  expected output so they can confirm they're on track.
- Concrete over abstract. Build one real, small thing end to end.
- Defer explanation. A one-line "we'll cover why later, for now do this" beats a
  three-paragraph detour. Link out for the why.
- Maintain momentum: small steps, frequent visible wins.

Template:
```
# Build <small real thing>
What you'll build (1–2 sentences + a picture of the end state)
Prerequisites (exact: versions, accounts, installs — checked, not assumed)
Step 1 … Step N   (each: do this → see this)
What you built (recap)
Next steps (links to how-tos / explanation)
```

## How-to guide — task-oriented

**Reader:** a competent user with a specific goal. They want it solved, now.
**Your promise:** a direct route to the result.

Rules:
- Title it as a task: "How to paginate results," not "Pagination."
- Address one real-world problem, not a feature. Real problems cross features.
- Assume competence: skip what a tutorial would explain.
- State the goal and any prerequisites up front, then the steps, then how to
  verify success.
- Show the smallest complete solution; link to reference for exhaustive options.

Template:
```
# How to <accomplish goal>
Goal (one sentence) + prerequisites
Steps (numbered, minimal, each actionable)
Verify it worked
Variations / gotchas (brief, or linked)
```

## Reference — information-oriented

**Reader:** someone who knows what they're looking for and needs it to be right.
**Your promise:** accuracy and completeness.

Rules:
- Describe the machinery; don't instruct or persuade. Austere and neutral.
- Be exhaustive and consistent. Same structure for every entry, same field order
  everywhere — reference is scanned, and consistency is what makes scanning work.
- Mirror the code's structure. Document behavior, not intent.
- A short example per entry is fine; a tutorial is not.
- Every entry: signature, parameters (name · type · required · default ·
  meaning), returns, errors, example.

Template:
```
## symbolName(signature)
One-line summary.
Parameters: table or list (name, type, required?, default, description)
Returns: type + meaning
Throws/Errors: conditions
Example: minimal, runnable
See also: related symbols
```

## Explanation — understanding-oriented

**Reader:** someone forming a mental model or making a decision. Not mid-task.
**Your promise:** clarity about *why*.

Rules:
- Discuss: design rationale, tradeoffs, alternatives considered, history,
  comparisons. Make connections.
- No step-by-step instructions and no exhaustive reference — link to those.
- It's okay to have an opinion here, as long as it's reasoned.
- Bound the scope; explanation sprawls if you let it.

Template:
```
# Understanding <concept>
The question this answers / why it matters
The core idea
How it works (conceptually, not procedurally)
Tradeoffs and alternatives
Where to go to act on this (links to how-tos/reference)
```

---

## Linking the four together

A healthy doc set connects them: a tutorial links to how-tos for next steps and
to explanation for the why; how-tos link to reference for full options; reference
links back to explanation for concepts. Each page does one job and hands off for
the rest.
