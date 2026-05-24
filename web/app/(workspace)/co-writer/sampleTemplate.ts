const FENCE = "```";

export const CO_WRITER_SAMPLE_TEMPLATE = `# AIMTutor Co-Writer

> AIMTutor's built-in writing canvas for notes, reports, tutorials, and AI-assisted drafts.

### Features

- Support Standard Markdown / CommonMark / GFM for everyday writing
- Real-time preview for headings, tables, code, math, flowchart, and sequence diagrams
- AI editing workflows for rewrite, shorten, and expand
- HTML tag decoding for tags like <sub>, <sup>, <abbr>, and <mark>
- A practical starter draft for AIMTutor product docs and learning content

## Table of Contents

[TOCM]

[TOC]

#AIMTutor Mission
##AIMTutor Product Surface
###AIMTutor Learning Experience
####AIMTutor Co-Writer
#####AIMTutor Knowledge Layer
######AIMTutor Agent Runtime

#AIMTutor Docs [Project Overview](#aimtutor-mission "Jump to project overview")
##AIMTutor Authoring [Co-Writer Section](#aimtutor-co-writer "Jump to co-writer section")
###AIMTutor Research [Learning Note](#aimtutor-learning-note "Jump to learning note")

## Headers (Underline)

AIMTutor Learning Note
=============

AIMTutor Study Outline
-------------

### Characters

----

~~Deprecated behavior~~ <s>Legacy formatting path</s>
*Italic* _Italic_
**Emphasis** __Emphasis__
***Emphasis Italic*** ___Emphasis Italic___

Superscript: X<sub>2</sub>, Subscript: O<sup>2</sup>

**Abbreviation(link HTML abbr tag)**

The <abbr title="Large Language Model">LLM</abbr> layer powers AIMTutor while the <abbr title="Retrieval Augmented Generation">RAG</abbr> layer provides grounded knowledge support.

### Blockquotes

> AIMTutor helps students turn questions into structured understanding.
>
> "Learn deeply, write clearly.", [AIMTutor](#aimtutor-co-writer)

### Links

[AIMTutor Overview](#aimtutor-mission)

[AIMTutor Co-Writer](#aimtutor-co-writer "co-writer section")

[AIMTutor Runtime](#aimtutor-agent-runtime)

[Reference link][aimtutor-doc]

[aimtutor-doc]: #aimtutor-learning-note

### Code Blocks

#### Inline code

\`aimtutor chat --once "Summarize this section"\`

#### Code Blocks (Indented style)

    from aimtutor.runtime.orchestrator import ChatOrchestrator
    orchestrator = ChatOrchestrator()
    print("AIMTutor is ready.")

#### Python

${FENCE}python
from aimtutor.runtime.orchestrator import ChatOrchestrator
from aimtutor.core.context import UnifiedContext


async def run_demo() -> str:
    orchestrator = ChatOrchestrator()
    context = UnifiedContext(
        user_query="Explain Newton's second law",
        capability="chat",
    )
    result = await orchestrator.run(context)
    return result.get("response", "")
${FENCE}

#### JSON config

${FENCE}json
{
  "app_name": "AIMTutor",
  "default_capability": "chat",
  "enabled_tools": ["rag", "web_search", "code_execution", "reason"],
  "ui": {
    "co_writer_template": true
  }
}
${FENCE}

#### HTML code

${FENCE}html
<section class="aimtutor-card">
  <h1>AIMTutor</h1>
  <p>Write, revise, and organize learning content with AI.</p>
</section>
${FENCE}

### Images

![](/logo-ver2.png)

> AIMTutor brand mark used inside the co-writer template.

### Lists

- AIMTutor Chat
- AIMTutor Co-Writer
- AIMTutor Research

1. Draft a concept note
2. Ask AI to refine it
3. Export the polished markdown

### Tables

Feature       | Description
------------- | -------------
Co-Writer     | Draft and refine Markdown content
Chat          | Ask questions and iterate ideas
Research      | Build structured multi-step reports

| Capability    | Primary Use Case                     |
| ------------- | ------------------------------------ |
| \`chat\`       | General tutoring and guidance        |
| \`deep_solve\` | Structured problem solving           |
| \`deep_question\` | Question generation and validation |

### Markdown extras

- [x] Draft a AIMTutor product note
- [x] Add references and structure
- [ ] Polish the final explanation
  - [ ] Check headings
  - [ ] Check citations

### TeX (LaTeX)

$$ E=mc^2 $$

Inline $$E=mc^2$$ appears in physics notes, and Inline $$a^2+b^2=c^2$$ appears in geometry notes.

$$\(\sqrt{3x-1}+(1+x)^2\)$$

$$ \sin(\alpha)^{\theta}=\sum_{i=0}^{n}(x^i + \cos(f))$$

### FlowChart

${FENCE}flow
st=>start: Student asks a question
op=>operation: AIMTutor analyzes intent
cond=>condition: Need deep workflow?
chat=>operation: Answer with chat capability
solve=>operation: Route to deep solve
e=>end: Return structured response

st->op->cond
cond(no)->chat
cond(yes)->solve
chat->e
solve->e
${FENCE}

### Sequence Diagram

${FENCE}seq
Student->AIMTutor: Ask for help
AIMTutor->KnowledgeBase: Load context
Note right of AIMTutor: Collect memory\nand relevant knowledge
AIMTutor-->Student: Return guided response
Student->>AIMTutor: Request rewrite in co-writer
${FENCE}

### End
`;
