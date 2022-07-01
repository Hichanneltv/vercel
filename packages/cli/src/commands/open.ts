import chalk from 'chalk';
import Client from '../util/client';
import getArgs from '../util/get-args';
import getScope from '../util/get-scope';
import handleError from '../util/handle-error';
import logo from '../util/output/logo';
import { getCommandName, getPkgName } from '../util/pkg-name';
import validatePaths from '../util/validate-paths';
import { ensureLink } from '../util/link-project';
import list from '../util/input/list';
import { Org, Project, Team } from '../types';
import { stringify } from 'querystring';
import execa from 'execa';
import link from '../util/output/link';

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} ${getPkgName()} login`)} <email or team>

  ${chalk.dim('Options:')}

    -h, --help                     Output usage information
    -A ${chalk.bold.underline('FILE')}, --local-config=${chalk.bold.underline(
    'FILE'
  )}   Path to the local ${'`vercel.json`'} file
    -Q ${chalk.bold.underline('DIR')}, --global-config=${chalk.bold.underline(
    'DIR'
  )}    Path to the global ${'`.vercel`'} directory

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Log into the Vercel platform

    ${chalk.cyan(`$ ${getPkgName()} login`)}

  ${chalk.gray('–')} Log in using a specific email address

    ${chalk.cyan(`$ ${getPkgName()} login john@doe.com`)}

  ${chalk.gray('–')} Log in using a specific team "slug" for SAML Single Sign-On

    ${chalk.cyan(`$ ${getPkgName()} login acme`)}

  ${chalk.gray('–')} Log in using GitHub in "out-of-band" mode

    ${chalk.cyan(`$ ${getPkgName()} login --github --oob`)}
`);
};

export default async function open(client: Client): Promise<number> {
  const { output } = client;
  let argv;

  try {
    argv = getArgs(client.argv.slice(2), {
      '--yes': Boolean,
    });
  } catch (error) {
    handleError(error);
    return 1;
  }

  if (argv['--help']) {
    help();
    return 2;
  }

  const yes = argv['--yes'] || false;

  let scope = null;

  try {
    scope = await getScope(client);
  } catch (err) {
    if (err.code === 'NOT_AUTHORIZED' || err.code === 'TEAM_DELETED') {
      output.error(err.message);
      return 1;
    }

    throw err;
  }

  const { team } = scope;

  let paths = [process.cwd()];

  const validate = await validatePaths(client, paths);
  if (!validate.valid) {
    return validate.exitCode;
  }
  const { path } = validate;

  const linkedProject = await ensureLink('project connect', client, path, yes);
  if (typeof linkedProject === 'number') {
    return linkedProject;
  }

  const { project, org } = linkedProject;
  client.config.currentTeam = org.type === 'team' ? org.id : undefined;

  const dashboardUrl = getDashboardUrl(org, project);
  const inspectorUrl = await getInspectorUrl(client, project, org, team);
  const latestDeploymentUrl = await getLatestDeploymentUrl(
    client,
    project,
    team
  );
  const latestProductionDeployment = await getLatestProdDeployment(
    client,
    project,
    team
  );

  const choice = await list(client, {
    message: 'What do you want to open?',
    choices: [
      {
        name: 'Dashboard',
        value: dashboardUrl,
        short: 'Dashboard',
      },
      {
        name: 'Latest Deployment Inspector',
        value: inspectorUrl || 'not_found',
        short: 'Deployment Inspector',
      },
      {
        name: 'Latest Preview Deployment',
        value: latestDeploymentUrl || 'not_found',
        short: 'Latest Preview Deployment',
      },
      {
        name: 'Latest Production Deployment',
        value: latestProductionDeployment || 'not_found',
        short: 'Latest Production Deployment',
      },
    ],
  });
  if (choice === 'not_found') {
    output.log(
      `No deployments found. Run ${chalk.cyan(
        getCommandName('deploy')
      )} to create a deployment.`
    );
    return 1;
  }
  if (choice === '') {
    // User aborted
    return 0;
  }

  execa('open', [choice]);
  output.log(`🪄 Opened ${link(choice)}`);
  return 0;
}

function getDashboardUrl(org: Org, project: Project): string {
  return `https://vercel.com/${org.slug}/${project.name}`;
}
async function getInspectorUrl(
  client: Client,
  project: Project,
  org: Org,
  team: Team | null
): Promise<string | undefined> {
  const proj = await getProject(client, project, team);
  if (proj) {
    const latestDeploymentId = proj.latestDeployments?.[0]?.id?.replace(
      'dpl_',
      ''
    );
    if (latestDeploymentId) {
      return `https://vercel.com/${org.slug}/${project.name}/${latestDeploymentId}`;
    }
  }
}
async function getLatestDeploymentUrl(
  client: Client,
  project: Project,
  team: Team | null
): Promise<string | undefined> {
  const proj = await getProject(client, project, team);
  if (proj?.latestDeployments?.[0]?.url) {
    return `https://${proj.latestDeployments[0].url}`;
  }
}
async function getLatestProdDeployment(
  client: Client,
  project: Project,
  team: Team | null
): Promise<string | undefined> {
  const proj = await getProject(client, project, team);
  if (proj?.targets?.production) {
    return `https://${proj.targets.production.url}`;
  }
}

async function getProject(
  client: Client,
  project: Project,
  team: Team | null
): Promise<Partial<Project> | undefined> {
  const proj = await client
    .fetch(
      `/v9/projects/${project.name}?${stringify({
        teamId: team?.id,
      })}`
    )
    .catch(err => {
      client.output.error(err.message);
      return undefined;
    });
  return proj as Project;
}
