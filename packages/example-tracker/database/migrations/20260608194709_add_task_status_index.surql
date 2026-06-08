-- 20260608194709_add_task_status_index — hand-written migration.
IF $direction = "up" {
    -- Non-unique index to speed up status filters on the task board.
    DEFINE INDEX task_status_idx ON TABLE task FIELDS status;
} ELSE {
    REMOVE INDEX IF EXISTS task_status_idx ON TABLE task;
};
