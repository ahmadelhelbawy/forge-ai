TASK (natural language, complete instruction):

Debug the intermittent auth session drop without changing the AuthProvider interface. Users report being logged out roughly once a day; it seems tied to token refresh. Done when we can describe the trigger and the fix holds for a week in production logs.
