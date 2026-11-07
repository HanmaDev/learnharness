/**
 * Fork (Windows test portability): FILE symlinks on Windows need admin
 * rights or Developer Mode (directory links use junctions, which need
 * neither). Tests whose fixtures need file symlinks skip with this reason
 * instead of failing with EPERM; with Developer Mode on they run for real.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const FILE_SYMLINK_SKIP =
	"file symlinks need Windows Developer Mode or admin rights (Settings > System > For developers)";

let probe: Promise<boolean> | undefined;

/** true everywhere except Windows without symlink privilege. */
export function fileSymlinksSupported(): Promise<boolean> {
	if (process.platform !== "win32") return Promise.resolve(true);
	probe ??= (async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-symlink-probe-"));
		const target = path.join(dir, "target");
		await fs.writeFile(target, "");
		try {
			await fs.symlink(target, path.join(dir, "alias"), "file");
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
			throw error;
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	})();
	return probe;
}
