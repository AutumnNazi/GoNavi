import { skipQuotedOrComment } from '../sqlEmbeddedWrite';

const jobCall = /\b(?:cron\s*\.\s*(?:schedule|schedule_in_database|alter_job|unschedule)|(?:dbms_scheduler|dbms_job|dbe_task|pkg_service)\s*\.\s*(?:create_job|set_attribute|set_attribute_null|set_job_argument_value|enable|disable|run_job|stop_job|drop_job|submit|change|what|interval|next_date|broken|remove|run|update|cancel|finish|job_submit|job_update|job_cancel|job_finish)|sp_(?:create_job|alter_job|rename_job|enable_job|drop_job|job_config_start|job_config_commit|add_job_step|alter_job_step|drop_job_step|add_job_schedule|alter_job_schedule|drop_job_schedule|dbms_job_run|dbms_job_run_async|stop_running_job))\s*\(/i;

export const hasJobMutationSQL = (sql: string, dialect: string): boolean => {
  let code = '';
  for (let index = 0; index < sql.length;) {
    const end = skipQuotedOrComment(sql, index, dialect);
    if (end > index) {
      code += sql[index] === '"' || sql[index] === '`' ? sql.slice(index + 1, end - 1) : ' ';
      index = end;
    } else code += sql[index++];
  }
  return jobCall.test(code);
};
