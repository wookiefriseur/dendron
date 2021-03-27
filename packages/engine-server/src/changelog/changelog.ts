import { DEngineClientV2, NoteUtils } from "@dendronhq/common-all";
import * as Diff2Html from "diff2html";
import execa from "execa";
import fs from "fs-extra";
import _ from "lodash";
import path from "path";
import { SiteUtils } from "../topics/site";

type Commits = {
  commits: CommitEntry[];
};
type CommitEntry = {
  commitDate: string;
  commitHash: string;
  changes: CommitChangeEntry[];
};
type CommitChangeEntry = {
  action: string;
  fname: string;
  diff: string;
};

async function getLastCommit(wsRoot: string) {
  // get last commit hash
  try {
    const { stdout } = await execa(
      "git",
      [`log`, `--pretty=format:'%h'`, `-n`, `1`],
      { cwd: wsRoot }
    );
    // use slice as there are quotes around the commit hash
    return stdout.slice(1, -1);
  } catch (error) {
    throw error;
  }
}

function canShowDiff(opts: {
  engine: DEngineClientV2;
  filePath: string;
}): boolean {
  const { engine, filePath } = opts;
  const { wsRoot, vaultsv3: vaults } = engine;
  return vaults.some((vault) => {
    if (filePath.startsWith(vault.fsPath) && filePath.endsWith(".md")) {
      const fname = path.basename(filePath.split(vault.fsPath)[1], ".md");
      const note = NoteUtils.getNoteByFnameV5({
        fname,
        notes: engine.notes,
        vault,
        wsRoot,
      });
      if (!note) {
        return false;
      }
      return SiteUtils.canPublish({ note, config: engine.config, engine });
    } else {
      return false;
    }
  });
}

/**
 * Return undefined if no changes, otherwise string with last commit
 */
// @ts-ignore
function getLastChangelogCommit(engine: DEngineClientV2): undefined | string {
  const buildDir = path.join(engine.wsRoot, "build");
  const changesPath = path.join(buildDir, "changes.json");
  if (!fs.existsSync(changesPath)) {
    return undefined;
  } else {
    const data: Commits = fs.readJSONSync(changesPath);
    return data.commits[0].commitHash;
  }
}

/**
 * Gets list of notes that were changed + commit hash and save it to file in build/ dir.
 */
export async function generateChangelog(engine: DEngineClientV2) {
  const { wsRoot, vaultsv3: vaults } = engine;
  const buildDir = path.join(wsRoot, "build");
  fs.ensureDirSync(buildDir);
  const changesPath = path.join(buildDir, "changes.json");
  // const lastCommit = getLastChangelogCommit(engine);
  //const commits = await getCommitUpTo(wsRoot, lastCommit);
  const commits = [await getLastCommit(wsRoot)];
  console.log(wsRoot, vaults, commits);

  const changes: CommitEntry[] = await Promise.all(
    commits.slice(0, 3).flatMap((commitHash) => {
      return getChanges({
        engine,
        commitHash,
      });
    })
  );
  fs.writeJSONSync(changesPath, { commits: changes });
}

// get files changed/added for a repo for the last commit
async function getChanges(opts: {
  commitHash: string;
  engine: DEngineClientV2;
}) {
  const { engine, commitHash } = opts;
  const { wsRoot } = engine;
  let commitDate: string = "";
  let changes: any[] = [];
  let filesChanged: string[] = [];

  // get files changed/added
  try {
    const { stdout } = await execa(
      "git",
      ["show", "--name-status", commitHash],
      {
        cwd: wsRoot,
        shell: true,
      }
    );
    let status = stdout.split("\n");
    status.map((result) => {
      if (result.startsWith("M")) {
        let filePath = result.split(" ")[0].substring(2);
        if (canShowDiff({ filePath, engine })) {
          filesChanged.push(filePath);
          changes.push({
            action: "Modified",
            fname: filePath,
          });
        }
      } else if (result.startsWith("A")) {
        let filePath = result.split(" ")[0].substring(2);
        if (canShowDiff({ filePath, engine })) {
          filesChanged.push(filePath);
          changes.push({
            action: "Added",
            fname: filePath,
          });
        }
      }
    });
  } catch (error) {
    throw error;
  }

  await Promise.all(
    changes.map(async (change) => {
      try {
        const { stdout } = await execa(
          "git",
          ["show", commitHash, "--", change.fname],
          { cwd: wsRoot, shell: true }
        );
        change.diff = Diff2Html.html(stdout);
        return Diff2Html.html(stdout);
      } catch (error) {
        throw error;
      }
    })
  );

  // get date of last commit
  try {
    const { stdout } = await execa("git", ["log", commitHash, "--format=%cd"], {
      cwd: wsRoot,
      shell: true,
    });
    let date = stdout.split(/\s+/).slice(1, 5);
    let day = date[0];
    let month = date[1];
    let year = date[3];
    commitDate = `${day} ${month} ${year}`;
  } catch (error) {
    throw error;
  }

  return {
    commitDate: commitDate,
    commitHash: commitHash,
    changes: changes,
  };
}