require("dotenv").config()
const steem = require("steem");
const config = require("./config.js");

const db = config.db;
const dsteem = require('dsteem');
const client = new dsteem.Client('https://api.steemit.com');

let trails = [];
let users = [];

const COUNTER_UPVOTE = -1;
const TRAIL_DOWNVOTE = 1;
const COUNTER_DOWNVOTE = 2;

async function get_trails()
{
    trails = await db("SELECT username, trailed, ratio, type FROM trail");
    let whitelists = await db("SELECT username, trailed FROM whitelist");
    users = await db("SELECT * from user_data");

    for (let i = 0; i < users.length; i++)
        users[i].whitelist = whitelists.filter(el => el.username === users[i].username).map(el => el.trailed);
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




function get_vote_value_vests(account, voting_power) {
    let total_vests = parseFloat(account.vesting_shares) + parseFloat(account.received_vesting_shares) - parseFloat(account.delegated_vesting_shares);
    let final_vest = total_vests * 1e6
    let power = (voting_power * 10000 / 10000) / 50
    let rshares = power * final_vest / 10000

    return rshares;
}

function get_downvote_power(account)
{
    const totalShares = parseFloat(account.vesting_shares) + parseFloat(account.received_vesting_shares) - parseFloat(account.delegated_vesting_shares) - parseFloat(account.vesting_withdraw_rate);

    const elapsed = Math.floor(Date.now() / 1000) - account.downvote_manabar.last_update_time;
    const maxMana = totalShares * 1000000 / 4;
    // 432000 sec = 5 days
    let currentMana = parseFloat(account.downvote_manabar.current_mana) + elapsed * maxMana / 432000;

    if (currentMana > maxMana) {
        currentMana = maxMana;
    }
    const currentManaPerc = currentMana * 100 / maxMana;

    return currentManaPerc
}

function get_vote_power(account)
{
    const totalShares = parseFloat(account.vesting_shares) + parseFloat(account.received_vesting_shares) - parseFloat(account.delegated_vesting_shares) - parseFloat(account.vesting_withdraw_rate);

    const elapsed = Math.floor(Date.now() / 1000) - account.voting_manabar.last_update_time;
    const maxMana = totalShares * 1000000;
    // 432000 sec = 5 days
    let currentMana = parseFloat(account.voting_manabar.current_mana) + elapsed * maxMana / 432000;

    if (currentMana > maxMana) {
        currentMana = maxMana;
    }
    const currentManaPerc = currentMana * 100 / maxMana;

    return currentManaPerc
}

function get_voting_data(usernames) {

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

            // Downvoting power
            let downvoting_power = get_downvote_power(account);
            let downvoting_vests = get_vote_value_vests(account, downvoting_power*100);

            // Voting power
            let voting_power = get_vote_power(account);
            let voting_vests = get_vote_value_vests(account, voting_power*100);

            voting_powers.push({username: account.name, downvoting_power,downvoting_vests,  voting_power, voting_vests })
        }

        return resolve(voting_powers);
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

        if (percentage > 0)
            console.log(`${username} upvoted @${author}/${permlink} with a ${percentage/100}% vote`);
        else
            console.log(`${username} downvoted @${author}/${permlink} with a ${percentage/100}% vote`);

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


function calculate_weight(post, user_voting_data, voter, ratio, vote_type)
{

    let vote = post.active_votes.filter(el => el.voter === voter)[0];

    let rshares = vote.rshares;
    if (rshares < 0)
        rshares *= -1;
    let percent = 0;

    let user_vests = 0;
    if (vote_type === "downvote")
        user_vests = user_voting_data.downvoting_vests;
    else
        user_vests = user_voting_data.voting_vests;


    // Our vote with our ratio is superior to theirs, let's vote with less power
    // we add 0.1% because of non-linear curve
    if ((user_vests * (ratio* vote.percent/10000) * 1.001) - rshares > 0)
    {
        // calculate percentage
        let rshare_per_vote_percent = (user_voting_data.downvoting_vests * 1.001)/100;
        percent = Math.ceil((rshares / rshare_per_vote_percent)*100) * ratio
    } else
    {
        if (vote.percent < 0)
            vote.percent *= -1;
        // Our max vote with the ratio is inferior to theirs, voting with maximum ratio.
        percent = Math.ceil(ratio * vote.percent);
    }

    // make sure that the vote percent isn't over 100% both ways
    percent = percent > 10000 ? 10000 : percent;
    percent = percent < -10000 ? -10000 : percent;

    if (vote_type === "downvote")
    {
        percent = -percent;
    }

    return percent;
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

                // Don't do anything when an user unvotes
                if (operation[1].weight !== 0) {

                    let affected_trails = trails.filter(el => el.trailed === voter);

                    if (affected_trails.length !== 0) {
                        let author = operation[1].author,
                            permlink = operation[1].permlink,
                            weight = operation[1].weight;


                        let voting_data = await get_voting_data(affected_trails.map(el => el.username));

                        for (let i = 0; i < affected_trails.length; i++) {

                            let user = users.filter(el => el.username === affected_trails[i].username)[0];
                            let user_voting_data = voting_data.filter(el => el.username === affected_trails[i].username)[0];

                            if (user.threshold < user_voting_data.downvoting_power) {

                                const post = await client.database.call("get_content", [author, permlink]);

                                if (has_already_beed_voted(affected_trails[i].username, post) === true)
                                    continue;

                                // These checks only make sense if we are downvoting
                                if (affected_trails[i].type === TRAIL_DOWNVOTE || affected_trails[i].type === COUNTER_UPVOTE) {
                                    if (parseFloat(post.pending_payout_value) === 0 || parseFloat(post.pending_payout_value) < user.min_payout)
                                        continue;

                                    // This posts accepts reward
                                    if (parseFloat(post.max_accepted_payout) === 0)
                                        continue;

                                    // This posts sends all rewards to the dao or null.
                                    if (parseFloat(post.beneficiaries.length) !== 0) {

                                        let null_benefs = post.beneficiaries.filter(el => el.account === "null")
                                        let dao_benefs = post.beneficiaries.filter(el => el.account === "steem.dao")

                                        let total_benefs = 0;

                                        if (null_benefs.length === 1)
                                            total_benefs += null_benefs[0].weight;
                                        if (dao_benefs.length === 1)
                                            total_benefs += dao_benefs[0].weight;

                                        // 100% to the dao or null or a combination of both
                                        if (total_benefs === 10000)
                                            continue;
                                    }
                                }

                                if (affected_trails[i].type === COUNTER_UPVOTE) {
                                    // if weight is inferior to 0 it means it's a downvote and we don't trail those
                                    if (weight <= 0)
                                        continue;
                                    if (user.whitelist.indexOf(author) !== -1)
                                        continue;

                                    weight = calculate_weight(post, user_voting_data, voter, affected_trails[i].ratio, "downvote");
                                } else if (affected_trails[i].type === TRAIL_DOWNVOTE) {

                                    if (user.whitelist.indexOf(author) !== -1)
                                        continue;

                                    // if weight is superior to  0 it means it's an upvote and we don't trail those
                                    if (weight >= 0)
                                        continue;

                                    weight = calculate_weight(post, user_voting_data, voter, affected_trails[i].ratio, "downvote");
                                } else if (affected_trails[i].type === COUNTER_DOWNVOTE) {
                                    // if weight is superior to  0 it means it's an upvote and we don't trail those
                                    if (weight >= 0)
                                        continue;

                                    weight = calculate_weight(post, user_voting_data, voter, affected_trails[i].ratio, "upvote");
                                }

                                vote_err_handled(affected_trails[i].username, process.env.DOWNVOTE_TOOL_WIF, author, permlink, weight)
                            }
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

