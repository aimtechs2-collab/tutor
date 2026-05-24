# AIMTutor CLI Skill

> Teach your AI agent to configure, manage, and use AIMTutor — an intelligent learning platform — entirely through the command line.

## When to Use

Use this skill when the user wants to:
- Set up or configure AIMTutor
- Chat with AIMTutor or run a capability (deep solve, quiz generation, deep research, math animation)
- Create, manage, or search knowledge bases
- Manage TutorBot instances
- View or manage learning memory, sessions, or notebooks
- Start the AIMTutor API server

## Prerequisites

- Python 3.11+
- AIMTutor installed: `pip install aimtutor` for the full Web app, `pip install aimtutor-cli` for CLI-only, or `pip install -e .` from a source checkout
- Run `aimtutor init` for first-time interactive setup (configures LLM, embedding, and search providers under `data/user/settings`)

## Commands

### Chat & Capabilities

```bash
# Interactive REPL
aimtutor chat
aimtutor chat --capability deep_solve --kb my-kb --tool rag --tool web_search

# One-shot capability execution
aimtutor run chat "Explain Fourier transform"
aimtutor run deep_solve "Solve x^2 = 4" --tool rag --kb textbook
aimtutor run deep_question "Linear algebra" --config num_questions=5
aimtutor run deep_research "Attention mechanisms" --kb papers
aimtutor run math_animator "Visualize a Fourier series"

# Options for `run`:
#   --session <id>         Resume existing session
#   --tool/-t <name>       Enable tool (repeatable): rag, web_search, code_execution, reason, brainstorm, paper_search
#   --kb <name>            Knowledge base (repeatable)
#   --notebook-ref <ref>   Notebook reference (repeatable)
#   --history-ref <id>     Referenced session id (repeatable)
#   --language/-l <code>   Response language (default: en)
#   --config <key=value>   Capability config (repeatable)
#   --config-json <json>   Capability config as JSON
#   --format/-f <fmt>      Output format: rich | json
```

### Knowledge Bases

```bash
aimtutor kb list                              # List all knowledge bases
aimtutor kb info <name>                       # Show knowledge base details
aimtutor kb create <name> --doc file.pdf      # Create from documents (--doc repeatable)
aimtutor kb add <name> --doc more.pdf         # Add documents incrementally
aimtutor kb search <name> "query text"        # Search a knowledge base
aimtutor kb set-default <name>                # Set as default KB
aimtutor kb delete <name> [--force]           # Delete a knowledge base
```

### TutorBot

```bash
aimtutor bot list                             # List all TutorBot instances
aimtutor bot create <id> --name "My Tutor"    # Create and start a new bot
aimtutor bot start <id>                       # Start a bot
aimtutor bot stop <id>                        # Stop a bot
```

### Memory

```bash
aimtutor memory show [summary|profile|all]    # View learning memory
aimtutor memory clear [summary|profile|all]   # Clear memory (--force to skip confirm)
```

### Sessions

```bash
aimtutor session list [--limit 20]            # List sessions
aimtutor session show <id>                    # View session messages
aimtutor session open <id>                    # Resume session in REPL
aimtutor session rename <id> --title "..."    # Rename a session
aimtutor session delete <id>                  # Delete a session
```

### Notebooks

```bash
aimtutor notebook list                        # List notebooks
aimtutor notebook create <name>               # Create a notebook
aimtutor notebook show <id>                   # View notebook records
aimtutor notebook add-md <id> <file.md>       # Import markdown as record
aimtutor notebook replace-md <id> <rec> <f>   # Replace a markdown record
aimtutor notebook remove-record <id> <rec>    # Remove a record
```

### System

```bash
aimtutor config show                          # Print current configuration
aimtutor plugin list                          # List registered tools and capabilities
aimtutor plugin info <name>                   # Show tool/capability details
aimtutor provider login <provider>            # OAuth login (openai-codex, github-copilot)
aimtutor serve [--port 8001] [--reload]       # Start API server
```

## REPL Slash Commands

Inside `aimtutor chat`, use these:

| Command | Effect |
|:---|:---|
| `/quit` | Exit REPL |
| `/session` | Show current session id |
| `/new` | Start a new session |
| `/tool on\|off <name>` | Toggle a tool |
| `/cap <name>` | Switch capability |
| `/kb <name>\|none` | Set or clear knowledge base |
| `/history add <id>` / `/history clear` | Manage history references |
| `/notebook add <ref>` / `/notebook clear` | Manage notebook references |
| `/refs` | Show active references |
| `/config show\|set\|clear` | Manage capability config |

## Typical Workflows

**First-time setup:**
```bash
cd AIMTutor
pip install -e .
aimtutor init    # Interactive guided setup
```

**Daily learning:**
```bash
aimtutor chat --kb textbook --tool rag --tool web_search
```

**Build a knowledge base from documents:**
```bash
aimtutor kb create physics --doc ch1.pdf --doc ch2.pdf
aimtutor run chat "Explain Newton's third law" --kb physics --tool rag
```

**Generate quiz questions:**
```bash
aimtutor run deep_question "Thermodynamics" --kb physics --config num_questions=5
```
