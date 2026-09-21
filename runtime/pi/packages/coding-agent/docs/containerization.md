# Containerization

Pi runs with all permissions by default, but in some cases, you will want to have more control over what directories Pi can write to and which accesses it has.

There are two general options. You can either
1. run the whole `weavra` process inside an isolated environment, or
2. run `weavra` on the host and route tool execution into an isolated environment.

## Choose a pattern

| Pattern | What is isolated | Best for | Notes |
| --- | --- | --- | --- |
| Gondolin extension | Built-in tools and `!` commands | Local micro-VM isolation while keeping auth on host | See [`examples/extensions/gondolin/`](../examples/extensions/gondolin/). |
| Plain Docker | Whole `weavra` process in a local container | Simple local isolation | Provider API keys enter the container. |
| OpenShell | Whole `weavra` process in a policy-controlled sandbox | Local or remote managed sandbox | Requires an OpenShell gateway and source-built Weavra image |
| Docker Sandboxes | Whole `weavra` process in a managed sandbox | Local isolation with provider keys kept on the host | Requires Docker Sandboxes (`sbx`) and a source-built Weavra kit |

Extensions run wherever the `weavra` process runs. If you run host `weavra` with a tool-routing extension, other custom extension tools still run on the host unless they also delegate their operations.

## Gondolin

[Gondolin](https://github.com/earendil-works/gondolin) is a local Linux micro-VM.
Use the [example extension](../examples/extensions/gondolin) when you want `weavra` on the host but all built-in tools routed into the VM.

Setup:

```bash
cp -R packages/coding-agent/examples/extensions/gondolin ~/.weavra/agent/extensions/gondolin
cd ~/.weavra/agent/extensions/gondolin
npm install --ignore-scripts
```

Run from the project you want mounted:

```bash
cd /path/to/project
weavra -e ~/.weavra/agent/extensions/gondolin
```

The extension mounts the host cwd at `/workspace` in the VM and overrides `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
User `!` commands are routed into the VM, as well.
File changes under `/workspace` write through to the host.

Requirements: Node.js >= 23.6.0 for `@earendil-works/gondolin`, plus QEMU (requires installation through your package manager).

## Plain Docker

Build a container from the Weavra source checkout using the root setup and the platform's native dependencies. No prebuilt Weavra container or upstream npm installer is a supported product source. Mount only the project and a dedicated Weavra home; do not mount host credentials/sessions unless deliberately granting that access. A container must launch the checkout's weavra entry, not PATH-selected upstream pi.

## OpenShell

Use [NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) when you want a policy-controlled sandbox with filesystem, process, network, credential, and inference controls.
OpenShell can run sandboxes through a local gateway backed by Docker, Podman, or a VM runtime, or through a remote Kubernetes gateway.

Every sandbox requires an active gateway.
Register and select one before creating a sandbox:

```bash
openshell gateway add <gateway-url> --name <name>
openshell gateway select <name>
```

Build an OpenShell image from the Weavra source checkout with its native dependencies and checkout-bound `weavra` launcher before creating a sandbox. No hosted Weavra image or recipe is configured; the upstream OpenShell Pi recipe is not a Weavra installation source.

In this pattern, the whole `weavra` process runs inside the sandbox.
Built-in tools, `!` commands, and extension tools execute inside the OpenShell boundary.

If the gateway is remote, project files are not bind-mounted from the host, meaning writes in the sandbox are not reflected on your machine.
Clone the repository inside the sandbox or use OpenShell file transfer commands:

```bash
openshell sandbox upload <sandbox-name> ./repo /workspace
openshell sandbox download <sandbox-name> /workspace/repo ./repo-out
```

OpenShell providers can keep raw model API keys outside the sandbox.
When inference routing is configured, code inside the sandbox can call `https://inference.local`, and the gateway injects the configured provider credentials upstream.
Configure Weavra to use the corresponding OpenAI-compatible or Anthropic-compatible endpoint if you want model traffic to use this route.

## Docker Sandboxes

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) is a managed sandbox runtime from Docker that can run the whole `weavra` process inside a source-built sandbox.
It is one of the container boundaries [No Built-in Sandbox](security.md#no-built-in-sandbox) points to.

Unlike the Plain Docker pattern above, the provider credential is not passed into the container.
The sandbox receives a sentinel value instead, and the `sbx` proxy substitutes the real credential on egress to `api.anthropic.com`.
Credentials are wired at creation time, so store yours on the host before you create the sandbox.

For a Claude Pro/Max subscription, run `claude setup-token` on a machine with Claude Code, then store the result on the host.
If an `anthropic` secret is already bound, remove it first: otherwise the proxy adds an `x-api-key` header alongside the Bearer token and Anthropic rejects the request.
`sbx secret set-custom` reads the token from stdin, so it stays out of shell history.

```bash
sbx secret rm anthropic

sbx secret set-custom \
  --host api.anthropic.com \
  --env ANTHROPIC_OAUTH_TOKEN \
  --placeholder 'sk-ant-oat01-{rand}'
```

The sandbox gets an OAuth-shaped placeholder, not the real token, and the proxy swaps it on egress to that host; `ANTHROPIC_OAUTH_TOKEN` is a variable the runtime already reads and prefers over an API key.

For an API key, store it with `sbx secret set anthropic` instead. The kit wires it the same way, as a sentinel the proxy substitutes on egress.

Build a dedicated kit from the Weavra source checkout, including native dependencies and the checkout-bound `weavra` launcher, before launching from the project you want mounted. No hosted Weavra kit is configured. The third-party `docker.io/sbx/pi-kit:latest` image pre-bakes upstream Pi; it is not a Weavra installation source.

Do not authenticate from inside the sandbox: `/login` there writes a real token into the container and defeats the proxy model.

After building and starting your Weavra sandbox, scripted use can invoke its checkout-bound launcher:

```bash
sbx exec <sandbox-name> -- weavra -p "list the failing tests"
```

See the [kit documentation](https://github.com/docker/sbx-kits-contrib/tree/main/pi) for the full credential matrix, troubleshooting, and pinning.
