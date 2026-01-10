export const easyTasks = [ 10, 29, 55, 63 ]
export const mediumTasks = [
    0,  2,  3,  4,  5,  6,  8, 11, 12, 14, 15, 16,
   17, 18, 19, 21, 22, 26, 27, 31, 32, 33, 35, 36,
   38, 39, 40, 42, 43, 47, 49, 50, 51, 52, 53, 54,
   59, 61, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74,
   76, 77, 79, 80, 84, 86, 87
 ]
export const hardTasks = [
    1,  7,  9, 13, 20, 23, 24, 25, 28,
   30, 34, 37, 41, 44, 45, 46, 48, 56,
   57, 58, 60, 62, 71, 75, 78, 81, 82,
   83, 85, 88
 ]


interface TaskRegistry {
	name: string;
	version: string;
	description: string;
	tasks: RegistryTaskEntry[];
}

export interface RegistryTaskEntry {
	name: string;
	git_url: string;
	git_commit_id?: string;
	path: string;
}


async function fetchRegistry(): Promise<TaskRegistry[]> {
    try {
        const response = await fetch('https://raw.githubusercontent.com/laude-institute/harbor/refs/heads/main/registry.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch registry: ${response.statusText}`);
        }
        return await response.json() as TaskRegistry[];
    } catch (error) {
        throw new Error(`Error fetching registry: ${error}`);
    }
}

export const getTaskIdByName = async (name: string) => {
  const registry = await fetchRegistry();
  const tBenchRegistry = registry[3];

  for (let i = 0; i < tBenchRegistry.tasks.length; i++){
    const taskName = tBenchRegistry.tasks[i].name;
    if(name === taskName) return i
  }

  return undefined
}
