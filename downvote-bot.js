require("dotenv").config()
const steem = require("steem");
const config = require("./config.js");

const db = config.db;
const dsteem = require('dsteem');
const client = new dsteem.Client('https://api.steemit.com');

let trails = [];
let users = [];


async function get_trails()
{
    trails = await db("SELECT username, trailed, ratio, negative FROM trail");
    users = await db("SELECT * from user_data");
}

function get_voting_power(usernames) {

    return new Promise(async resolve => {

        let accounts = await client.database.getAccounts(usernames).catch(function (err) {
            if (err) {
                if (err.message === "HTTP 504: Gateway Time-out" || err.message === "HTTP 502: Bad Gateway") {
                    console.log("Error 504/502")
                } else
                    console.error(err);
                return resolve([]);
            }
        });

        let voting_powers = [];

        for (let i = 0; i < accounts.length; i++) {

            let account = accounts[i];

            const totalShares = parseFloat(account.vesting_shares) + parseFloat(account.received_vesting_shares) - parseFloat(account.delegated_vesting_shares) - parseFloat(account.vesting_withdraw_rate);

            const elapsed = Math.floor(Date.now() / 1000) - account.downvote_manabar.last_update_time;
            const maxMana = totalShares * 1000000 / 4;
            // 432000 sec = 5 days
            let currentMana = parseFloat(account.downvote_manabar.current_mana) + elapsed * maxMana / 432000;

            if (currentMana > maxMana) {
                currentMana = maxMana;
            }

            const currentManaPerc = currentMana * 100 / maxMana;

            voting_powers.push({username : account.name, downvoting_power : currentManaPerc})

        }
        return resolve(voting_powers);
    })
}


function wait(time)
{
    return new Promise(resolve => {
        setTimeout(() => resolve('☕'), time*1000); // miliseconds to seconds
    });
}



function vote(username, wif, author, permlink, weight) {

    return new Promise(async resolve => {

        const private_key = dsteem.PrivateKey.fromString(wif);

        await client.broadcast.vote({
            voter: username,
            author: author,
            permlink: permlink,
            weight: weight
        }, private_key).catch(async function(error) {
            if (error.message.indexOf("Can only vote once every 3 seconds") !== -1)
                console.error("Can only vote once every 3 seconds");
            else if (error.message === "HTTP 504: Gateway Time-out" || error.message === "HTTP 502: Bad Gateway" || error.message.indexOf("request to https://api.steemit.com failed, reason: connect ETIMEDOUT") !== -1 || error.message.indexOf("transaction tapos exception") !== -1)
                console.error("Error 504/502");
            else
                console.error(error);
            await wait(5);
            return resolve(error);
        });

        await wait(5);
        return resolve("");

    })
}

function vote_err_handled(username, wif, author, permlink, percentage)
{
    return new Promise(async resolve => {

        percentage = Math.floor(percentage);

        let result = await vote(username, wif, author, permlink, percentage);

        if (result !== "") {
            for (let k = 0; k < 10; k++) {
                console.error("vote failed for " + username + " voting on " + author + "/" + permlink);
                result = await vote(username, wif, author, permlink, percentage);
                if (result === "") {
                    console.log(`${username} downvoted @${author}/${permlink} with a ${percentage / 100}% vote`)
                    return resolve("");
                }
            }
        }

        console.log(`${username} downvoted @${author}/${permlink} with a ${percentage/100}% vote`)
        return resolve("");

            });
}

function has_already_beed_voted(voter, post) {

        if (post.active_votes.filter(el => el.voter === voter).length !== 0)
        {
            return true
        } else
        {
            return false
        }
}

function stream() {
    steem.api.setOptions({
        url: "https://api.steemit.com"
    });
    return new Promise((resolve, reject) => {

        steem.api.streamOperations( async (err, operation)  => {
            if (err) return reject(err);

            if (operation[0] === "vote") {
                let voter = operation[1].voter;

                // Check if the voter is trailed or not

                let affected_trails = trails.filter(el => el.trailed === voter);

                if (affected_trails.length !== 0) {
                    let author = operation[1].author,
                        permlink = operation[1].permlink,
                        weight = operation[1].weight;

                    let downvoting_powers = await get_voting_power(affected_trails.map(el => el.username));

                    for (let i = 0; i < affected_trails.length; i++) {

                        let user = users.filter(el => el.username === affected_trails[i].username)[0];
                        let user_vp = downvoting_powers.filter(el => el.username === affected_trails[i].username)[0];

                        if (user.threshold < user_vp.downvoting_power) {

                            const post = await client.database.call("get_content", [author, permlink]);

                            if (has_already_beed_voted(affected_trails[i].username, post) === true)
                                continue;

                            if (parseFloat(post.pending_payout_value) === 0 || parseFloat(post.pending_payout_value) < user.min_payout)
                                continue;

                            // This posts accepts reward
                            if (parseFloat(post.max_accepted_payout) === 0)
                                continue;

                            weight = Math.ceil(affected_trails[i].ratio * weight);

                            // make sure that the weight isn't over 100% both ways
                            weight = weight > 10000 ? 10000 : weight;
                            weight = weight < -10000 ? -10000 : weight;

                            if (affected_trails[i].negative === -1) {
                                // if weight is inferior to 0 it means it's a downvote and we don't trail those
                                if (weight < 0)
                                    continue;

                                // if the trail is negative, change the upvote to a downvote
                                weight *= -1;
                            } else {
                                // if weight is superior to  0 it means it's an upvote and we don't trail those
                                if (weight > 0)
                                    continue;
                            }

                            vote_err_handled(affected_trails[i].username, process.env.DOWNVOTE_TOOL_WIF, author, permlink, weight)
                        }
                    }
                }
            }
        });

    }).catch(err => {
        console.log(err);
        stream();
    });
}


async function run()
{
    console.log("Starting...");
    await get_trails();

    stream()
    // Update trail data every minute
    while (true)
    {
        await get_trails();
        await wait(60)
    }
}


run();

