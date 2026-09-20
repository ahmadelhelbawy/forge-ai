TASK (natural language, complete instruction):

Fix the brute-force bypass in the login rate limiter without adding friction
for legitimate users and without redesigning auth. No new dependencies.
The limiter must still allow normal logins, and you must add a regression
test proving 101 rapid spoofed requests are blocked. Do not add CAPTCHA.

