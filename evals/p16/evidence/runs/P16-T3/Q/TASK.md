TASK (natural language, complete instruction):

Fix the credential leak: connecting with a bad database URL logs the full
URL including the password. Redact secrets in log output and add a
regression test proving no secret reaches the logs. Keep the log line
format unchanged so existing consumers keep parsing. No new dependencies.
Do not log request bodies anywhere.

