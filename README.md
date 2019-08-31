This is the bot that performs the downvoting. 

If you want to spin this yourself, you'll need to create a .env file with this format :

```
DB_USERNAME=username

DB_PASSWORD=dbpassword

DOWNVOTE_TOOL_WIF=posting_key 

```

The posting key is the posting key of the account which holds all the posting authorities. 

You will also need to create a mysql database called downvote_control_tool

The sql for the database is written on this repo :

https://github.com/drov0/downvote-control-tool-back


## running 

> npm i 

Create the .env file 

> node downvote-bot.js

Or if you have pm2 installed 

> pm2 downvote-bot.js --name bot

pm2 is cleaner, I suggest you go that route