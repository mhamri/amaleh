import { For } from 'solid-js';
import PageMeta from '../../components/PageMeta';
import CommandFigure from '../../components/CommandFigure';
import DocsLayout, { type DocsSection } from '../../components/docs/DocsLayout';
import InstallSequence from '../../components/diagrams/InstallSequence';
import { asset } from '../../lib/paths';
import { INSTALL_COMMANDS } from '../../lib/install';
import { articleGraph } from '../../lib/seo';

const sections: DocsSection[] = [
  { id: 'prerequisites', label: 'Prerequisites' },
  { id: 'install', label: 'Install the skill' },
  { id: 'uninstall', label: 'Uninstall the skill' },
  { id: 'credentials', label: 'Credentials and network' },
  { id: 'first-run', label: 'Your first run' },
];

const firstRun = [
  {
    title: 'Check the machine',
    body: 'Run the doctor check. It is local: it reports the runtime engine and version, the platform, the pi executable it resolved, whether OpenRouter credentials were found, and the Jev endpoint. It does not prove network connectivity.',
  },
  {
    title: 'Link the skill',
    body: 'Run the install operation. It links amaleh/ into the current user’s Codex and Claude skill directories and refuses conflicting destinations, then leaves the checkout in place for the link to point at.',
  },
  {
    title: 'Invoke the skill with your task',
    body: 'Invoke /amaleh with the outcome you want. The skill handles discovery, planning, delegation, review and resume; you do not ask it which step comes next.',
  },
  {
    title: 'Resume by invoking again',
    body: 'A closed session is not a background scheduler. Invoking the skill again lists the workspace’s runs and resumes the one matching your request from its last checkpoint.',
  },
];

export default function DocsGettingStarted() {
  const crumb = { name: 'Getting started', path: 'docs/getting-started/' };
  const title = 'Getting started — Amaleh documentation';
  const description =
    'Prerequisites, installation, OpenRouter and pi credentials, and the commands for a first Amaleh run.';
  return (
    <>
      <PageMeta
        path={crumb.path}
        title={title}
        description={description}
        structuredData={articleGraph({ crumb, headline: title, description })}
      />
      <DocsLayout
        current="getting-started"
        title={crumb.name}
        lead="From a stable checkout to a first delegated run: what the machine needs, how the skill is installed, where credentials live, and the operations that start and resume a run."
        sections={sections}
      >
        <InstallSequence />

        <section data-reveal>
          <h2 id="prerequisites" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Prerequisites
          </h2>
          <ul class="mt-4 list-inside list-disc space-y-2 text-dim">
            <li>
              <span class="text-base-content">Bun</span>, or <span class="text-base-content">Node 24 or newer</span> for the fallback launcher. The skill’s TypeScript CLI runs on either.
            </li>
            <li>
              <span class="text-base-content">pi configured with OpenRouter</span>, or <span class="text-base-content">OPENROUTER_API_KEY</span> provided through your environment.
            </li>
            <li>
              <span class="text-base-content">A <span class="font-mono text-sm">git clone</span> of the repository</span>. Clone <span class="font-mono text-sm">https://github.com/mhamri/amaleh</span> to a stable location. Installation links the amaleh/ directory into your skill directories, so the checkout must stay in place afterwards.
            </li>
            <li>
              <span class="text-base-content">No global package installation</span>. The runtime has no npm runtime dependencies; installation only links the skill directories.
            </li>
          </ul>
        </section>

        <section data-reveal>
          <h2 id="install" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Install the skill
          </h2>
          <p class="mt-4 text-base leading-relaxed">
            Clone the repository and run both operations from the checkout root, with Bun or with Node 24 or newer.
          </p>
          <CommandFigure
            class="mt-6"
            label="sh"
            command={INSTALL_COMMANDS}
            location="getting-started"
          />
          <p class="mt-6 text-base leading-relaxed">
            <span class="font-mono text-sm text-base-content">doctor</span> takes no run and changes nothing. <span class="font-mono text-sm text-base-content">install</span> writes the skill links and refuses conflicting destinations; it never touches repository files or credentials.
          </p>
        </section>

        <section data-reveal>
          <h2 id="uninstall" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Uninstall the skill
          </h2>
          <p class="mt-4 text-base leading-relaxed">
            Run the uninstall operation from the checkout root to remove the skill links.
          </p>
          <figure class="mt-6 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>sh</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`bun amaleh/scripts/run.ts uninstall`}</code></pre>
          </figure>
          <p class="mt-6 text-base leading-relaxed">
            <span class="font-mono text-sm text-base-content">uninstall</span> removes the links <span class="font-mono text-sm text-base-content">install</span> wrote into the Codex and Claude skill directories. It refuses conflicting targets — a real directory, a file, or a link that resolves elsewhere — and never touches the checkout.
          </p>
        </section>

        <section data-reveal>
          <h2 id="credentials" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Credentials and network
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Use pi’s existing OpenRouter credential, or provide <span class="font-mono text-sm text-base-content">OPENROUTER_API_KEY</span> through your environment. Never put credentials in the repository. Expired pi credentials are refreshed through pi.
            </p>
            <p>
              Before the first OpenRouter operation in a session, run <span class="font-mono text-sm text-base-content">preflight</span> through the same execution channel that will launch Jev and pi. It makes one bounded request with a ten-second timeout and validates the credential and the Jev response shape. It sends no project content, grants no permission, and changes no global setting.
            </p>
          </div>
          <figure class="mt-6 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>sh</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`bun amaleh/scripts/run.ts preflight ./my-project my-run preflight.json`}</code></pre>
          </figure>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>preflight.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "network": "allowed", "channel": "pi" }`}</code></pre>
          </figure>
          <p class="mt-4 text-base leading-relaxed">
            The input declares the host’s effective network status and the execution channel; an existing run is optional, and a fresh run id is enough. A result of <span class="font-mono text-sm text-base-content">ready</span> means the credential and the Jev response shape were verified.
          </p>
          <div class="alert alert-soft alert-warning rounded-box mt-6 border border-line text-sm">
            <span>
              Network access and permission to send project context remain host-controlled. When the host reports restricted networking, request its supported network permission before making requests instead of spending retries in a blocked sandbox.
            </span>
          </div>
        </section>

        <section data-reveal>
          <h2 id="first-run" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Your first run
          </h2>
          <p class="mt-4 text-base leading-relaxed">
            Four steps take a checkout from unconfigured to a delegated, checkpointed run.
          </p>
          <ol class="mt-6 grid gap-4">
            <For each={firstRun}>
              {(step, index) => (
                <li class="flex gap-4 rounded-box border border-line bg-base-200 p-5 shadow-rest">
                  <span class="badge badge-soft badge-primary h-fit shrink-0 text-xs">{index() + 1}</span>
                  <div class="min-w-0">
                    <p class="font-sans text-lg font-semibold">{step.title}</p>
                    <p class="mt-2 text-sm leading-relaxed text-dim">{step.body}</p>
                  </div>
                </li>
              )}
            </For>
          </ol>
          <p class="mt-6 text-base leading-relaxed">
            The same steps are available through the CLI. <span class="font-mono text-sm text-base-content">list</span> returns one summary per run — id, status, intent, acceptance criteria and task count — so it is read before deciding what to do next. <span class="font-mono text-sm text-base-content">start</span> takes host, model, intent, acceptance criteria and constraints from an input file, because structured values are never built by the shell.
          </p>
          <figure class="mt-6 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>sh</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`bun amaleh/scripts/run.ts list ./my-project
bun amaleh/scripts/run.ts start ./my-project my-first-run input.json`}</code></pre>
          </figure>
          <p class="mt-6 text-base leading-relaxed">
            Next, read the <a class="link link-hover text-primary" href={asset('docs/workflow/')}>workflow</a> to see how a run moves from discovery to verified delivery, or go straight to the <a class="link link-hover text-primary" href={asset('docs/commands/')}>command reference</a>.
          </p>
        </section>
      </DocsLayout>
    </>
  );
}