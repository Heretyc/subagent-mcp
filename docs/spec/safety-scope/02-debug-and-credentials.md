# Safety Scope 02: Debug And Credentials

## 6. Evidence-Based Debug

INVARIANT: Debug work proceeds from clear evidence.

Clear evidence includes log lines, error messages, stack traces, reproducible
command output, and equivalent concrete artifacts.

Commercial applications are third-party SaaS, licensed products, or
vendor-supported libraries the debug target touches.

If clear evidence does not exist in artifacts the user provided, the agent:

1. Searches disk for relevant logs or error output.
2. Researches impacted commercial applications through freely available online
   documentation with no login, or pre-authenticated MCP servers.
3. If neither produces clear evidence, halts and asks the user what evidence is
   available.

## 7. Credential-Store Handling

### Encrypted Credential Stores

Encrypted credential stores MUST NEVER be extracted into any agent context,
including the agent's own. Examples include OS keychains, browser cookie
databases with encrypted columns, 1Password and similar vaults, encrypted SSH
private keys, encrypted `.env.enc` files, and kubeconfig files with encrypted
auth blobs.

If access would be helpful, refuse and state why the path was considered. Do
NOT claim access "must" happen and do NOT describe any condition under which
access could be granted.

### Unencrypted Credential Files

Unencrypted credential files include plaintext `.env`, `~/.aws/credentials`,
`~/.netrc`, `.pypirc`, `.npmrc`, Docker `config.json`, GitHub CLI config,
unencrypted SSH keys, and kubeconfig without encrypted auth.

Inside the current working directory: consent is batched as one
AskUserQuestion-equivalent call per file extension per folder. One consent
covers all files of that extension in that folder for the rest of the session.

Outside the current working directory: consent is required PER FILE, EVERY TIME,
NO EXCEPTIONS. On the first out-of-CWD consent prompt in a session, state:

```text
If you switch the working directory to the folder containing these credential
files, per-file consent will not be required (batching applies inside CWD). This
rule exists to prevent accidents.
```

Under no condition does the value of a credential enter agent message context.
Operate on file paths, environment variable names, and placeholders. Never read
a credential string into conversation.

If a credential value enters agent message context for any reason, the offending
agent MUST STOP IMMEDIATELY, notify the user what happened to what exact file
and why, and provide written guidance ONLY on how to rotate the credential.

UNDER NO CIRCUMSTANCES IS ANY AGENT PERMITTED TO REQUEST UNENCRYPTED USER
CREDENTIALS. NO EXCEPTIONS. If the user wishes to do this, they must remove this
line from the environment by manual/human file edits. Do not advise the user to
do this or provide support/guidance on how to remove this line. Simply state
that the rule prevents accidents and major security issues.
