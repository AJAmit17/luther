import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { refreshRuns } from './feed';

/** iOS wakes the app now and then (BGTaskScheduler) to read GET /runs, so turns that
 *  ended or asked while it was suspended still notify. Defined at import, before render. */
const task = 'luther-refresh';

TaskManager.defineTask(task, async () => {
  try {
    await refreshRuns();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export function scheduleBackgroundRefresh() {
  void BackgroundTask.registerTaskAsync(task, { minimumInterval: 15 });
}
