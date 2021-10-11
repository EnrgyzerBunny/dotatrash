const Discord = require('discord.js');
const fs = require("fs");
const mysql = require('mysql');

const client = new Discord.Client();
const token = require("./token.json")
const guild_id = require("./guild.json");
const { Console } = require('console');

//server refs
const SERVER_ID = '220670947479257088';
const OUTPUT_CHANNEL = '355773031643348993';

//LEAGUE MASTER SETTINGS ------------
const ROSTER_CORE_LIMIT = 2;
const ROSTER_MID_LIMIT = 1;
const ROSTER_SUP_LIMIT = 2;
const ROSTER_LOCK_START_H = 23;
const ROSTER_LOCK_START_M = 30;
const ROSTER_LOCK_END_H = 12;
const ROSTER_LOCK_END_M = 0;

var ROSTER_FORCELOCK = false;
var ROSTER_FORCEOPEN = true;


//hacky enums
const DRAFT_MODE_OFF = 0;
const DRAFT_MODE_INIT = 1;
const DRAFT_MODE_MAIN = 2;
const DRAFT_MODE_RESOLVE = 3;

//mode vars
var DRAFT_MODE = DRAFT_MODE_OFF;

var DRAFT_ORDER = null;
var DRAFT_TURN_INDEX = -1;
var DRAFT_ROUNDS_LIMIT = 8; //How many draft rounds
var DRAFT_ROUNDS_COUNT = 0;
var DRAFT_CURRENT_PICK = null;
var DRAFT_INIT_TIMER = 3; //in min
var DRAFT_ROUND_TIMER = 2; //in min
var DRAFT_PLAYERS = null;
var DRAFT_USER_TEAMS = null;
var DRAFT_GUILD_ID = null;
var DRAFT_CHANNEL_ID = null;

//timer message
var timerMessage = null;
var timerCount = 0;
var currentTimer = null;

// user mapping
var userMap;
if (fs.existsSync('data/userMapping.json')){

    let rawdata = fs.readFileSync('data/userMapping.json');
    userMap = JSON.parse(rawdata);
}
else
{
    //Send error code directly to me
    client.users.cache.get('109498432921546752').send("Error: Unable to read user mapping file");
}

//DB pooling
const TrashDBPool = mysql.createPool({
    connectionLimit: 10,
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider",
    multipleStatements: true

});
console.log("TrashDBPool Created.");



process.on("unhandledRejection", error => console.error("Promise rejection:", error));

client.on('ready', () => {

    console.log("Client Initiated.");


    //Slash Command handling
    client.ws.on('INTERACTION_CREATE', async interaction => {
        try{

        const command = interaction.data.name.toLowerCase();
        const args = interaction.data.options;

        var user;
        var method = "GUILD";
        if (interaction.member == null){
            //slash command was sent via DM
            method = "DM";
            user = interaction.user;
        }
        else{
            user = interaction.member.user;
        }

        if (command === 'teams'){ 
            let currentSeason = await GetCurrentSeasonId();
            PullTeams(interaction.id, interaction.token,currentSeason);
        }

        if (command === 'join'){ 
            //Verify user isn't already an owner
            if (IsUser(user.id)){
                //already a user
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Unable to join: User is already a member of the league."
                        }
                    }
                });
                return;
            }

            //Add owner to TrashDB
            AddOwner(user.id);
            //Add mapping to user listing
            AddMapping(user.id);

            //Confirmation
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Joined successfully."
                    }
                }
            });
        }

        if (command === 'createteam'){ 
            //Verify user is an owner
            if (!IsUser(user.id)){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the league, please use the /join command."
                        }
                    }
                });
                return;
            }
            //Verify owner does not already have a team
            let currentSeason = await GetCurrentSeasonId();
            console.log("Season: " + currentSeason);
            if (await HasTeam(user.id,currentSeason)) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Unable to create team: Team already exists."
                        }
                    }
                });
                return;
            }

            //Sanitize
            console.log(JSON.stringify(args));
            let teamName = null;
            for (var i = 0; i < args.length;i++)
            {
                if (args[i].name == "name"){
                    teamName = args[i].value.replace('\''||';'||'"','');
                    break;
                }
            }

            if (teamName == null){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Unable to create team: Team name not provided."
                        }
                    }
                });
                return;
            }

            //Create
            CreateTeam(user.id, currentSeason, teamName);

            //Confirmation
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Team created successfully."
                    }
                }
            });
        }

        if (command === 'draftorder') {
            let subCommand = args[0].name;

            if (subCommand == "list")
            {
                let draftList = await GetDraftList();
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: draftList
                        }
                    }
                });

                return;
            }
            else if (subCommand == "set") {
                let order = args[0].options[0].value;
                DRAFT_ORDER = order.replace(" ","").split(',');
                order = "";
                for (var i = 0; i < DRAFT_ORDER.length;i++) {
                    order += ((i > 0)? "," : "") + DRAFT_ORDER[i];
                }

                let output = "Draft order set to:\n```\n" + order + "\n```";

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output
                        }
                    }
                });
                return;
            }
            
        }


        //TODO: deprecate this - this is no longer an exposed command
        if (command === 'timer') {
            var length = args[0].value;
            
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Timer Created",
                        flags: 64
                    }
                }
            });

            if (currentTimer != null)
            {
                timerMessage.edit("Stopped");
                clearInterval(currentTimer);
                currentTimer = null;
            }
            timerCount = length;
            timerMessage = await client.guilds.cache.get(interaction.guild_id).channels.cache.get(interaction.channel_id).send("```\n" + millisecondsToTime(length) + "\n```");
            
            currentTimer = SetTimer(5000,() => UpdateDraftTimer(5000,() => {}));
        }

        if (command === 'draft') {
            
            if (args != null && args[0] != null && args[0].value == "true")
            {
                //set order to random
                DRAFT_ORDER = await GetDraftListIDs();
                shuffle(DRAFT_ORDER);
            }
            else if (DRAFT_ORDER == null)
            {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Draft order not set. Please use /draftorder or set randomized to true.",
                            flags: 64
                        }
                    }
                });
                return;
            }

            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Starting Draft Mode",
                        flags: 64
                    }
                }
            });

            DRAFT_MODE = DRAFT_MODE_INIT;

            client.guilds.cache.get(interaction.guild_id).channels.cache.get(interaction.channel_id).send("```\nDraft Mode: Spooling up\n```");
            DRAFT_PLAYERS = await GetFreeAgents();
            DRAFT_USER_TEAMS = await GetUserTeams();
            client.guilds.cache.get(interaction.guild_id).channels.cache.get(interaction.channel_id).send("```\nDraft Mode: Starting in " + DRAFT_INIT_TIMER + " min\n```");

            
            if (currentTimer != null)
            {
                timerMessage.edit("Stopped");
                clearInterval(currentTimer);
                currentTimer = null;
            }
            timerCount = 1000 * 60 * DRAFT_INIT_TIMER;
            timerMessage = await client.guilds.cache.get(interaction.guild_id).channels.cache.get(interaction.channel_id).send("```\n" + millisecondsToTime(timerCount) + "\n```");
            
            DRAFT_TURN_INDEX = -1;
            DRAFT_ROUNDS_COUNT = 0;
            DRAFT_GUILD_ID = interaction.guild_id;
            DRAFT_CHANNEL_ID = interaction.channel_id;
            currentTimer = SetTimer(5000,() => UpdateDraftTimer(5000,() => NextDraftTurn(DRAFT_GUILD_ID,DRAFT_CHANNEL_ID)));
            

        }

        if (command === 'pick') {

            if (DRAFT_MODE != DRAFT_MODE_MAIN)
            {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "No draft running."
                        }
                    }
                });
                return;
            }

            var userTeam = null;
            for (var i = 0; i < DRAFT_USER_TEAMS.length; i++)
            {
                if (user.id == DRAFT_USER_TEAMS[i].user)
                {
                    userTeam = DRAFT_USER_TEAMS[i];
                }
            }

            if (userTeam == null) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the draft."
                        }
                    }
                });
                return;
            }

            //check if user is current active draft user
            if (DRAFT_ORDER[DRAFT_TURN_INDEX] != userTeam.ownerID) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "It is not your turn."
                        }
                    }
                });
                return;
            }

            var playerID = args[0].value;
            var player = null;

            for (var i = 0; i < DRAFT_PLAYERS.length; i++)
            {
                if (DRAFT_PLAYERS[i].id == playerID)
                {
                    player = DRAFT_PLAYERS[i];
                    break;
                }
            }

            if (player == null) {
                var errOutput = "Invalid pick: Player " + playerID + " does not exist";
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: errOutput
                        }
                    }
                });
                return;
            }

            playerName = player.name;

            if (player.drafted) {
                var errOutput = "Invalid pick: Player " + playerID + " | " + playerName + " has already been drafted";
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: errOutput
                        }
                    }
                });
                return;
            }

            

            DRAFT_CURRENT_PICK = player;



            var output = interaction.member.nick + " has selected " + playerID + " | " + playerName + "\nUse /confirmpick to lock in and end your turn";
            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: output
                    }
                }
            });
            return;
        }

        if (command === 'freeagents') {

            var page = 1;

            if (args != null && args[0] != null)
            {
                page = args[0].value;
            }

            var freeAgents = await GetFreeAgentsPrint(page);

            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: freeAgents,
                        flags: 64
                    }
                }
            });

            return;
        }

        if (command === 'confirmpick') {
            if (DRAFT_MODE != DRAFT_MODE_MAIN)
            {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "No draft running."
                        }
                    }
                });
                return;
            }

            var userTeam = null;
            for (var i = 0; i < DRAFT_USER_TEAMS.length; i++)
            {
                if (user.id == DRAFT_USER_TEAMS[i].user)
                {
                    userTeam = DRAFT_USER_TEAMS[i];
                }
            }

            if (userTeam == null) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the draft."
                        }
                    }
                });
                return;
            }

            //check if user is current active draft user
            if (DRAFT_ORDER[DRAFT_TURN_INDEX] != userTeam.ownerID) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "It is not your turn."
                        }
                    }
                });
                return;
            }

            //check if there is a current pick
            if (DRAFT_CURRENT_PICK == null) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "No pick is selected."
                        }
                    }
                });
                return;
            }

            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Pick locked in",
                        flags: 64
                    }
                }
            });

            //end timer and cycle turn
            if (currentTimer != null)
            {
                clearInterval(currentTimer);
                currentTimer = null;
                timerMessage.edit("```Time's up```");
                timerMessage = null;
                NextDraftTurn(DRAFT_GUILD_ID,DRAFT_CHANNEL_ID);
                return;
            }

            

        }

        if (command === 'pushdraft') {

            if (DRAFT_MODE != DRAFT_MODE_RESOLVE)
            {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Draft not in correct phase",
                            flags: 64
                        }
                    }
                });
            }

            ApplyDraftResults();
            DRAFT_MODE = DRAFT_MODE_OFF;
            DRAFT_ORDER = null;
            DRAFT_USER_TEAMS = null;
            DRAFT_TURN_INDEX = -1;
            DRAFT_ROUNDS_COUNT = 0;
            DRAFT_GUILD_ID = null;
            DRAFT_CHANNEL_ID = null;

            client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: "Draft Applied",
                        flags: 64
                    }
                }
            });
        }

        //Active Season Commands - Commands which will be enabled and used only during the main league season

        if (command === 'roster') {
            let subCommand = args[0].name;

            //initial error handling

            if (!IsUser(user.id)){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the league.",
                            flags: 64
                        }
                    }
                });
                return;
            }
            //Verify owner has a team
            let currentSeason = await GetCurrentSeasonId();
            if (await !HasTeam(user.id,currentSeason)) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You do not have a team.",
                            flags: 64
                        }
                    }
                });
                return;
            }


            //subcommands
            if (subCommand === 'list') {
                let output = await PrintTeamRoster(user.id);

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output,
                            flags: 64
                        }
                    }
                });
                return;
            }

            if (subCommand === 'bench') {

                var hours = new Date().getHours();
                var min = new Date().getMinutes();
                if (!ROSTER_FORCEOPEN && (ROSTER_FORCELOCK || (hours > ROSTER_LOCK_START_H || (hours == ROSTER_LOCK_START_H && min >= ROSTER_LOCK_START_M)) ||
                    ((hours < ROSTER_LOCK_END_H) || hours == ROSTER_LOCK_END_H && min <= ROSTER_LOCK_END_M))) {
                        client.api.interactions(interaction.id, interaction.token).callback.post({
                            data: {
                                type: 4,
                                data: {
                                    content: "Request Failed - Rosters are Locked.",
                                    flags: 64
                                }
                            }
                        });
                        return;
                }

                let playerId = args[0].options[0].value;
                
                let roster = await FetchTeamRoster(user.id);
                var player = null;

                for (var i = 0; i < roster.length; i++)
                {
                    if (roster[i].PlayerID == playerId) {
                        player = roster[i];
                        break;
                    }
                }

                if (player == null) {
                    let output = "Error: Player not found on roster."

                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                if (player.PlayStatus == 0) {
                    let output = "Error: Player already on bench."

                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }


                let output = await BenchPlayer(player.PlayerID);
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output,
                            flags: 64
                        }
                    }
                });
                return;
            }

            if (subCommand === 'play') {
                var hours = new Date().getHours();
                var min = new Date().getMinutes();
                if (!ROSTER_FORCEOPEN && (ROSTER_FORCELOCK || (hours > ROSTER_LOCK_START_H || (hours == ROSTER_LOCK_START_H && min >= ROSTER_LOCK_START_M)) ||
                ((hours < ROSTER_LOCK_END_H) || hours == ROSTER_LOCK_END_H && min <= ROSTER_LOCK_END_M))) {
                        client.api.interactions(interaction.id, interaction.token).callback.post({
                            data: {
                                type: 4,
                                data: {
                                    content: "Request Failed - Rosters are Locked.",
                                    flags: 64
                                }
                            }
                        });
                        return;
                }

                let playerId = args[0].options[0].value;
                
                let roster = await FetchTeamRoster(user.id);
                var player = null;

                for (var i = 0; i < roster.length; i++)
                {
                    if (roster[i].PlayerID == playerId) {
                        player = roster[i];
                        break;
                    }
                }

                if (player == null) {
                    let output = "Error: Player not found on roster."

                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                if (player.PlayStatus == 1) {
                    let output = "Error: Player already in active play."

                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                //check role limit
                if (IsAtRosterLimit(player.FantasyRole,roster))
                {
                    let output = "Error: Too many of this role in active play, bench a player of this role first"

                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }


                let output = await UnBenchPlayer(player.PlayerID);
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output,
                            flags: 64
                        }
                    }
                });
                return;
            }

        }

        if (command === 'request') {
            let subCommand = args[0].name;

            //initial error handling

            if (!IsUser(user.id)){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the league.",
                            flags: 64
                        }
                    }
                });
                return;
            }
            //Verify owner has a team
            let currentSeason = await GetCurrentSeasonId();
            if (await !HasTeam(user.id,currentSeason)) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You do not have a team.",
                            flags: 64
                        }
                    }
                });
                return;
            }

            //subcommands
            if (subCommand === 'list') {
                let output = await PrintRequestList(user.id);
                if (output == null) {
                    output = "Error pulling list";
                }

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output,
                            flags: 64
                        }
                    }
                });
                return;
            }

            if (subCommand === 'history') {
                var page = 1;

                if (args[0].options != null && args[0].options[0] != null)
                {
                    page = args[0].options[0].value;
                }
                let output = await PrintRequestHistory(page);
                if (output == null) {
                    output = "Error pulling list";
                }

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output,
                            flags: 64
                        }
                    }
                });
                return;
            }

            if (subCommand === 'cancel') {
                let reqId = args[0].options[0].value;
                let playerReqs = await FetchPendingUserRequests(user.id);

                var exists = false;
                for (var i = 0; i < playerReqs.length; i++) {
                    if (playerReqs[i].RequestID == reqId) {
                        exists = true;
                    }
                }

                if (!exists) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "This is not a valid request Id to cancel.",
                                flags: 64
                            }
                        }
                    });
                    return;
                }
                else {
                    let output = await CancelRequest(reqId);
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }
            }

            if (subCommand === 'submit') {
                let pickups = new Array();
                let drops = new Array();

                if (args[0].options == null) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "Invalid Request: no drops or pickups specified",
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                for (var i = 0; i < args[0].options.length; i++) {
                    
                    let tempArray = args[0].options[i].value.replace(" ","").split(",");

                    if (tempArray == null) {
                        tempArray = new Array();
                    }

                    for (var x = 0; x < tempArray.length; x++) {
                        
                        if (args[0].options[i].name === 'pickups')
                            pickups.push(Number(tempArray[x]));
                        else if (args[0].options[i].name === 'drops')
                            drops.push(Number(tempArray[x]));
                    }
                
                }

                console.log("Pickups: " + pickups.join(","));
                console.log("Drops: " + drops.join(","));

                //TODO:confirm but this should be a redundant check as its evaluated above
                //invalid empty request
                if (pickups.length <= 0 && drops.length <= 0) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "Invalid Request: no drops or pickups specified",
                                flags: 64
                            }
                        }
                    });
                    return;

                }

                let dropOnly = false;

                //check if drop-only request
                if (pickups.length <= 0 && drops.length > 0) {
                    dropOnly = true;
                }
                else {

                    let pickupCheck = await VerifyPickups(pickups);

                    if (!pickupCheck) {
                        client.api.interactions(interaction.id, interaction.token).callback.post({
                            data: {
                                type: 4,
                                data: {
                                    content: "Invalid Request: Pickups contains invalid or unavailable players",
                                    flags: 64
                                }
                            }
                        });
                        return;
                    }
                }


                //drops check
                let roster = await FetchTeamRoster(user.id);
                

                //0 - valid
                //1 - invalid - player is not on bench
                //2 - invalid - id does not match player on your team

                let validCode = 0;

                if (roster.length <= 0 && drops.length > 0){
                    validCode = 2;
                }
                else {
                    for (var x = 0; x < drops.length; x++) {
                        for (var i = 0;i < roster.length; i++) {
                            if (roster[i].PlayerID == drops[x])
                            {
                                if (roster[i].PlayStatus == 1) {
                                    validCode = 1;
                                }
                                break;
                            }
                            if (i == roster.length - 1) {
                                validCode = 2;
                            }
                        }
    
                        if (validCode != 0) {
                            break;
                        }
                    }
                }

                

                if (validCode != 0) {
                    let output = "Invalid Request: " + ((validCode == 1)? "Requested drop is not bench" :
                    "Requested drop id does not match player on your team");
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }
                

                if (dropOnly) {
                    let output = await DropPlayers(drops);
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });

                    
                    SubmitDropLog(user.id,drops);
                    return;

                }
                else {
                    let output = await SubmitRequest(user.id,pickups,drops);
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }
                
                

            }

        }

        if (command === 'trade') {
            let subCommand = args[0].name;

            //initial error handling

            if (!IsUser(user.id)){
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You are not in the league.",
                            flags: 64
                        }
                    }
                });
                return;
            }
            //Verify owner has a team
            let currentSeason = await GetCurrentSeasonId();
            if (await !HasTeam(user.id,currentSeason)) {
                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "You do not have a team.",
                            flags: 64
                        }
                    }
                });
                return;
            }

            //subcommands
            if (subCommand === 'list') {
                let output = await PrintTradeList(user.id);
                if (output == null) {
                    output = "Error pulling list";
                }

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output,
                            flags: 64
                        }
                    }
                });
                return;
            }

            if (subCommand === 'cancel') {
                let tradeId = args[0].options[0].value;
                let pending = await FetchTradeList();
                if (pending == null || pending.length <= 0) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "Invalid Trade ID",
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                for (var i = 0; i < pending.length;i++) {
                    if (pending[i].OwnerName == user.id && pending[i].RequestID == tradeId) {
                        let output = await CancelRequest(tradeId);
                        client.api.interactions(interaction.id, interaction.token).callback.post({
                            data: {
                                type: 4,
                                data: {
                                    content: output,
                                    flags: 64
                                }
                            }
                        });
                        let recipient = await FetchTradeRecipient(pending[i].RequestedPlayerID.toString().split('-'));
                        let notification = "A user has canceled a trade pending with you.";
                        SendPM(recipient,notification);
                        return;
                    }
                }

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Invalid Trade ID",
                            flags: 64
                        }
                    }
                });

                return;
            }

            if (subCommand === 'respond') {
                let pending = await FetchTradeList();
                if (pending == null || pending.length <= 0) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "You have no pending trades to respond to.",
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                let tradeID = null;
                let response = null;

                for (var i = 0; i < args[0].options.length; i++) {
                    if (args[0].options[i].name == "tradeid") {
                        tradeID = args[0].options[i].value;
                    }
                    else if (args[0].options[i].name == "action") {
                        response = args[0].options[i].value;
                    }
                }

                for (var i = 0; i < pending.length;i++) {
                    if (pending[i].RequestID == tradeID) {
                        let recipient = await FetchTradeRecipient(pending[i].RequestedPlayerID.toString().split('-'));
                        if (recipient != user.id) {
                            client.api.interactions(interaction.id, interaction.token).callback.post({
                                data: {
                                    type: 4,
                                    data: {
                                        content: "Invalid: This trade is not pending with you",
                                        flags: 64
                                    }
                                }
                            });
                            return;
                        }

                        if (response == "Accept") {

                            let output = await AcceptTrade(pending[i],user.id);
                            client.api.interactions(interaction.id, interaction.token).callback.post({
                                data: {
                                    type: 4,
                                    data: {
                                        content: output,
                                        flags: 64
                                    }
                                }
                            });
                            let sender = await FetchTradeRecipient(pending[i].RequestedPlayerID.toString().split('-'));
                            //owner of req player as trade has already been enacted at this point
                            let notification = "Your trade has been accepted.";
                            SendPM(sender,notification);
                            return;

                        }
                        else
                        {
                            let output = await DenyTrade(tradeID);
                            client.api.interactions(interaction.id, interaction.token).callback.post({
                                data: {
                                    type: 4,
                                    data: {
                                        content: output,
                                        flags: 64
                                    }
                                }
                            });
                            let sender = await FetchTradeRecipient(pending[i].GivenPlayerID.toString().split('-'));
                            let notification = "Your trade has been denied.";
                            SendPM(sender,notification);
                            return;
                        }
                        
                        
                        
                    }
                }

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: "Invalid Trade ID",
                            flags: 64
                        }
                    }
                });
                return;
            }

            if (subCommand === 'new') {
                
                //consume pickups and drops and validate they are provided
                let pickups = new Array();
                let given = new Array();

                if (args[0].options == null) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "Invalid Request: no given or requested players specified",
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                for (var i = 0; i < args[0].options.length; i++) {
                    
                    let tempArray = args[0].options[i].value.replace(" ","").split(",");

                    if (tempArray == null) {
                        tempArray = new Array();
                    }

                    for (var x = 0; x < tempArray.length; x++) {
                        
                        if (args[0].options[i].name === 'pickups')
                            pickups.push(Number(tempArray[x]));
                        else if (args[0].options[i].name === 'given')
                            given.push(Number(tempArray[x]));
                    }
                
                }

                if (pickups.length != given.length) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "Invalid Request: pickups and drops must be same amount.",
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                
                //drops check
                let roster = await FetchTeamRoster(user.id);
                

                //0 - valid
                //1 - invalid - player is not on bench
                //2 - invalid - id does not match player on your team

                let validCode = 0;

                if (roster.length <= 0 && given.length > 0){
                    validCode = 2;
                }
                else {
                    for (var x = 0; x < given.length; x++) {
                        for (var i = 0;i < roster.length; i++) {
                            if (roster[i].PlayerID == given[x])
                            {
                                if (roster[i].PlayStatus == 1) {
                                    validCode = 1;
                                }
                                break;
                            }
                            if (i == roster.length - 1) {
                                validCode = 2;
                            }
                        }
    
                        if (validCode != 0) {
                            break;
                        }
                    }
                }

                

                if (validCode != 0) {
                    let output = "Invalid Request: " + ((validCode == 1)? "Given player is not bench" :
                    "Given player id does not match player on your team");
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });
                    return;
                }

                //check that no pickups are part of teams own roster
                for (var i = 0;i < pickups.length; i++) {
                    for (var x = 0; x < roster.length; x++) {
                        if (roster[x].PlayerID == pickups[i]) {
                            client.api.interactions(interaction.id, interaction.token).callback.post({
                                data: {
                                    type: 4,
                                    data: {
                                        content: "Invalid Request: Cannot request a pickup of a player already on your roster",
                                        flags: 64
                                    }
                                }
                            });
                            return;
                        }
                    }
                }

                let pickupCheck = await VerifyTradePickups(pickups);

                    if (!pickupCheck) {
                        client.api.interactions(interaction.id, interaction.token).callback.post({
                            data: {
                                type: 4,
                                data: {
                                    content: "Invalid Request: Pickups contains unavailable players or players from multiple teams",
                                    flags: 64
                                }
                            }
                        });
                        return;
                    }
                
                let output = await SubmitTradeRequest(user.id,pickups,given);
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: output,
                                flags: 64
                            }
                        }
                    });

                let recipient = await FetchTradeRecipient(pickups);
                let notification = "A user has sent you a trade request, use </trade list> command to respond.";
                SendPM(recipient,notification);
                return;
            }


        }

        if (command === 'scores') {

            var all = false;

            if (args != null && args[0] != null)
            {
                all = args[0].value;
            }

            //initial league error handling if a user is not displaying all scores (if all scores it doesnt matter)
            if (!all) {
                if (!IsUser(user.id)){
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "You are not in the league.",
                                flags: 64
                            }
                        }
                    });
                    return;
                }
                //Verify owner has a team
                let currentSeason = await GetCurrentSeasonId();
                if (await !HasTeam(user.id,currentSeason)) {
                    client.api.interactions(interaction.id, interaction.token).callback.post({
                        data: {
                            type: 4,
                            data: {
                                content: "You do not have a team.",
                                flags: 64
                            }
                        }
                    });
                    return;
                }
            }

            let output = await PrintScores(user.id,all);
                if (output == null) {
                    output = "Error pulling list";
                }

                client.api.interactions(interaction.id, interaction.token).callback.post({
                    data: {
                        type: 4,
                        data: {
                            content: output
                        }
                    }
                });
                return;
        }


    } catch (err) {
        DiscordLog("Command error: " + err);
        Client.api.interactions(interaction.id, interaction.token).callback.post({
            data: {
                type: 4,
                data: {
                    content: "Command Error.",
                    flags: 64
                }
            }
        });
        return;
    }
    });
});

client.login(token.token);

function PullTeams(interactionid, interactiontoken,currentSeason)
{
    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;

        connection.query("SELECT * FROM Team WHERE SeasonID = " + currentSeason, function (err, result, fields) {
            
            console.log(JSON.stringify(result));
    
            let output = "```\n";
    
            for (var i = 0; i < result.length;i++)
            {
                output += result[i].TeamName + " | Season " + (Number(result[i].SeasonID) + 1) + "\n";
            }
    
            output += "```";
    
    
            client.api.interactions(interactionid, interactiontoken).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: output
                    }
                }
            });
            connection.release();
            if (err) throw err;
    
        });


    });
    
}

function IsUser(userId){

    for (let i = 0;i < userMap.length; i++){
        if (userMap[i].discord == userId){
            return true;
        }
    }
    return false;

}

function AddOwner(userId){

    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;
        connection.query("INSERT INTO Owner(OwnerName) VALUES ('" + userId + "')", function (err, result, fields) {
            
            console.log(JSON.stringify(result));

            connection.release();
            if (err) throw err;
        });

    });
    

}

function AddMapping(userId){

    var mapping = {
        discord: userId
    };
    userMap.push(mapping);

    WriteMapping();

}

function WriteMapping(){
    let rawdata = JSON.stringify(userMap, null, 2);
    fs.writeFileSync('data/userMapping.json', rawdata, (err) => {
        if (err){
            client.users.cache.get('109498432921546752').send("Error: Unable to write user mapping file");
        }
        
    });
}

function GetCurrentSeasonId()
{
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;

            connection.query("SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1", function (err, result, fields) {
                
                //console.log(JSON.stringify(result));
                resolve(Number(result[0].SeasonID));
                connection.release();
                if (err) throw err;
                
            });
        });
        

    });
}

function HasTeam(userId, currentSeason)
{
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT TeamID, SeasonID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE OwnerName = '" + userId + "' ORDER BY SeasonID DESC LIMIT 1", function (err, result, fields) {
                
                //console.log(JSON.stringify(result));
                if (result.length == 0){
                    resolve(false);
                }
                else
                {
                    resolve(Number(result[0].SeasonID) == currentSeason);
                }
                connection.release();
                if (err) throw err;
                
            });
        });
        

    });
}

function CreateTeam(ownerName, season, teamName){
    
    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;
        connection.query("INSERT INTO Team(TeamName,SeasonID,OwnerID) SELECT '" + teamName + "', '" + season + "', OwnerID FROM Owner WHERE OwnerName = '" + ownerName + "'", function (err, result, fields) {
            
            console.log(JSON.stringify(result));
            connection.release();
            if (err) throw err;
        });
    });
    
}

function GetDraftList() {

    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Owner.OwnerID, Owner.OwnerName FROM Owner JOIN Team ON Owner.OwnerID = Team.OwnerID WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1)", async function (err, result, fields) {
                
                let output = "```\n"
                for (var i = 0; i < result.length;i++)
                {
                    let nick = await client.guilds.cache.get(SERVER_ID).members.fetch(result[i].OwnerName);                    
                    output += result[i].OwnerID + " | " + nick.displayName + "\n";
                }
                output += "```";

                resolve(output);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function GetDraftListIDs() {

    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Owner.OwnerID, Owner.OwnerName FROM Owner JOIN Team ON Owner.OwnerID = Team.OwnerID WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1)", async function (err, result, fields) {
                
                let output = new Array();
                for (var i = 0; i < result.length;i++)
                {
                    output.push(result[i].OwnerID);
                }

                resolve(output);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function SetTimer(tickrate, updateFunc) {
    return setInterval(updateFunc,tickrate);
}

function UpdateDraftTimer(tickrate,callback) {
    
    timerCount-=tickrate;
    if (timerCount <= 0)
    {
        if (currentTimer != null)
        {
            clearInterval(currentTimer);
            currentTimer = null;
            timerMessage.edit("```Time's up```");
            timerMessage = null;
            callback();
            return;
        }
    }

    var output = "```\n" + millisecondsToTime(timerCount) + "\n```";
    

    timerMessage.edit(output);
}

function millisecondsToTime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor((ms  / 1000 / 3600 ) % 24)
  
    const formatted = [
        hours.toString().padStart(2,'0'),
        minutes.toString().padStart(2,'0'),
        seconds.toString().padStart(2,'0')
    ].join(':');
  
    return formatted;
}

async function NextDraftTurn(guild_id,channel_id) {


    //if this isnt the first time run then apply pick
    if (DRAFT_TURN_INDEX != -1) {
        ApplyPick(guild_id,channel_id);
    }

    DRAFT_MODE = DRAFT_MODE_MAIN;
    //increment turns
    DRAFT_TURN_INDEX++;

    if (DRAFT_TURN_INDEX >= DRAFT_ORDER.length)
    {
        DRAFT_TURN_INDEX = 0;
        DRAFT_ROUNDS_COUNT++;
        //zigzag order
        DRAFT_ORDER = DRAFT_ORDER.reverse();
    }

    if (DRAFT_ROUNDS_COUNT >= DRAFT_ROUNDS_LIMIT) {
        //Draft over
        DRAFT_MODE = DRAFT_MODE_RESOLVE;

        DraftEnd(guild_id,channel_id);
        return;
    }

    var currentUser = null;
    for (var i = 0;i < DRAFT_USER_TEAMS.length;i++) {
        if (Number(DRAFT_USER_TEAMS[i].ownerID) == Number(DRAFT_ORDER[DRAFT_TURN_INDEX])) {
            currentUser = DRAFT_USER_TEAMS[i];
        }
    }

    if (currentUser == null) {
        client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("Error - Invalid OwnerID in draft order... Aborting draft mode.");
        return;
    }

    //message @ing current turn owner - include round number
    client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("```Round " + (DRAFT_ROUNDS_COUNT + 1) + 
        ":```<@!"+ currentUser.user + "> It is your turn you have " + DRAFT_ROUND_TIMER + " min to pick with the /pick command");

    if (currentTimer != null)
    {
        timerMessage.edit("Stopped");
        clearInterval(currentTimer);
        currentTimer = null;
    }
    timerCount = 1000 * 60 * DRAFT_ROUND_TIMER;
    timerMessage = await client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("```\n" + millisecondsToTime(timerCount) + "\n```");
    
    currentTimer = SetTimer(5000,() => UpdateDraftTimer(5000,() => NextDraftTurn(guild_id,channel_id)));

}

function GetFreeAgents()
{
    return new Promise(function (resolve, reject)
    {
        var freeAgents = new Array();

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Player.PlayerID, Player.PlayerName, Player.FantasyRole, ProTeam.ProTeamName FROM Player JOIN ProTeam ON Player.ProTeamID = ProTeam.ProTeamID WHERE Player.FantasyTeamID = 0", function (err, result, fields) {
                
                for (var i = 0; i < result.length; i++) {
                    let player = {
                        id: result[i].PlayerID,
                        name: result[i].PlayerName,
                        role: result[i].FantasyRole,
                        team: result[i].ProTeamName,
                        drafted: false
                    };
                    freeAgents.push(player);
                }
                

                resolve(freeAgents);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function GetFreeAgentsPrint(page) {

    var limit = 35;
    var offset = (page - 1) * limit;
    var filterIDs = (DRAFT_MODE == DRAFT_MODE_MAIN)? GetDraftFilter() : null;
    var draftFilter = (filterIDs != null)? " AND Player.PlayerID NOT IN (" + GetDraftFilter() + ")" : "";
    return new Promise(function (resolve, reject)
    {
        var formattedOutput = "```Page: " + page + "\n";

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Player.PlayerID, Player.PlayerName, Player.FantasyRole, ProTeam.ProTeamName FROM Player JOIN ProTeam ON Player.ProTeamID = ProTeam.ProTeamID WHERE Player.FantasyTeamID = 0" + draftFilter + " ORDER BY ProTeam.ProTeamID ASC, Player.FantasyRole ASC LIMIT " + offset + "," + limit, function (err, result, fields) {
                
                for (var i = 0; i < result.length; i++) {
                   

                    formattedOutput+= result[i].PlayerID.toString().padStart(3," ") + " | ";
                    formattedOutput+= result[i].PlayerName.toString().padEnd(15," ") + " | ";
                    formattedOutput+= result[i].ProTeamName.toString().padEnd(16," ") + " | ";

                    var role;
                    switch(result[i].FantasyRole) {
                        case (1):
                            role = "Core";
                            break;
                        case (2):
                            role = "Support";
                            break;
                        case (4):
                            role = "Mid";
                            break;
                        default:
                            role = "Unknown";
                            break;

                    }

                    formattedOutput+= role.toString().padEnd(7," ") + "\n";
                    

                    
                }
                
                formattedOutput += "```";

                resolve(formattedOutput);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function GetDraftFilter() {
    var drafted = new Array();

    for (var i = 0;i < DRAFT_PLAYERS.length;i++) {
        if (DRAFT_PLAYERS[i].drafted == true) {
            drafted.push(DRAFT_PLAYERS[i].id);
        }
    }

    if (drafted.length <= 0)
    {
        return null;
    }

    return drafted.join(",");

}

function GetUserTeams() {
    return new Promise(function (resolve, reject)
    {
        var userTeams = new Array();

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT TeamName, OwnerName, Owner.OwnerID, TeamID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1)", function (err, result, fields) {
                
                for (var i = 0; i < result.length; i++) {
                    let userTeam = {
                        user: result[i].OwnerName,
                        team: result[i].TeamName,
                        ownerID: result[i].OwnerID,
                        teamID: result[i].TeamID,
                        picks: new Array()
                    };
                    userTeams.push(userTeam);
                }
                

                resolve(userTeams);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function ApplyPick(guild_id,channel_id) {

    var currentUser = null;
    for (var i = 0;i < DRAFT_USER_TEAMS.length;i++) {
        if (Number(DRAFT_USER_TEAMS[i].ownerID) == Number(DRAFT_ORDER[DRAFT_TURN_INDEX])) {
            currentUser = DRAFT_USER_TEAMS[i];
        }
    }

    if (currentUser == null) {
        client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("Error - Invalid OwnerID in draft order... Aborting draft mode.");
        return;
    }

    if (DRAFT_CURRENT_PICK == null) {

        client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("No pick set - assigning random pick.");
        //random if none picked
        var available = new Array();
        for (var i = 0; i < DRAFT_PLAYERS.length;i++)
        {
            if (DRAFT_PLAYERS[i].drafted == false) {
                available.push(DRAFT_PLAYERS[i]);
            }
        }

        shuffle(available);

        if (available.length <= 0)
        {
            client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("Error - No available players left to assign.");
            return;
        }
        DRAFT_CURRENT_PICK = available[0];
    }

    client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("<@!"+ currentUser.user + "> has drafted "
        + DRAFT_CURRENT_PICK.id + " | " + DRAFT_CURRENT_PICK.name);

        //set player in list to drafted
        for (var i = 0; i < DRAFT_PLAYERS.length; i++)
            {
                if (DRAFT_PLAYERS[i].id == DRAFT_CURRENT_PICK.id)
                {
                    DRAFT_PLAYERS[i].drafted = true;
                    break;
                }
            }

        //add pick to userteam entry
        for (var i = 0;i < DRAFT_USER_TEAMS.length;i++) {
            if (Number(DRAFT_USER_TEAMS[i].ownerID) == Number(currentUser.ownerID)) {
                DRAFT_USER_TEAMS[i].picks.push(DRAFT_CURRENT_PICK.id);
                console.log("Applied pick:\n" + JSON.stringify(DRAFT_USER_TEAMS[i]));
                break;
            }
        }

        DRAFT_CURRENT_PICK = null;

}

function DraftEnd(guild_id,channel_id) {
    client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("Draft Completed - Displaying Results:");

    
    for (var i = 0; i < DRAFT_USER_TEAMS.length; i++) {
        if (DRAFT_USER_TEAMS[i].picks.length <= 0) {
            continue;
        }
        var output = "```\n";
        output+= DRAFT_USER_TEAMS[i].team + ":\n";
        output+= String("ID").padStart(3," ") + "|" +
            String("Player").padEnd(14," ") + "|" +
            String("Role").padEnd(7," ") + "|" +
            String("ProTeam").padEnd(12," ") + "\n";
        output += "----------------------------------------\n";

        for (var x = 0; x < DRAFT_USER_TEAMS[i].picks.length;x++) {
            let player = GetCachedPlayerInfo(DRAFT_USER_TEAMS[i].picks[x]);
            if (player != null) {

                var role;
                    switch(player.role) {
                        case (1):
                            role = "Core";
                            break;
                        case (2):
                            role = "Support";
                            break;
                        case (4):
                            role = "Mid";
                            break;
                        default:
                            role = "Unknown";
                            break;

                    }

                output += player.id.toString().padStart(3," ") + "|" +
                player.name.toString().padEnd(14," ") + "|" + 
                role.padEnd(7," ") + "|" +
                player.team.toString().padEnd(12," ") + "\n";
            }

        }
        output += "```";
        client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send(output);
    }

    client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("Draft admins can apply draft to DB with /pushdraft");

}

function ApplyDraftResults() {

    var query = "";
    for (var i = 0; i < DRAFT_USER_TEAMS.length; i++) {
        if (DRAFT_USER_TEAMS[i].picks.length <= 0) {
            continue;
        }
        query += "UPDATE Player SET FantasyTeamID = " + DRAFT_USER_TEAMS[i].teamID + " WHERE PlayerID IN (" + DRAFT_USER_TEAMS[i].picks.join(",") + ")" +";";
        

    }

    query = query.slice(0,-1);

    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;
        connection.query(query, function (err, result, fields) {
            
            console.log(JSON.stringify(result));
            connection.release();
            if (err) throw err;
        });
    });
     

}

function GetCachedPlayerInfo(playerID) {

    for (var i = 0; i < DRAFT_PLAYERS.length; i++) {
        if (DRAFT_PLAYERS[i].id == playerID) {
            return DRAFT_PLAYERS[i];
        }
    }

    return null;

}

function PrintTeamRoster(userId) {

    return new Promise(function (resolve, reject)
    {
        var formattedOutput = "```\n";

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Team.TeamName, ProTeam.ProTeamName, ProTeam.ProTeamTag, Player.PlayerID, Player.PlayerName, Player.AccountID, Player.FantasyRole, Player.PlayStatus FROM Player JOIN Team ON Player.FantasyTeamID = Team.TeamID JOIN Owner ON Team.OwnerID = Owner.OwnerID JOIN ProTeam ON Player.ProTeamID = ProTeam.ProTeamID WHERE Owner.OwnerName = " + userId, function (err, result, fields) {
                
                if (result.length <= 0)
                {
                    resolve("```None\n```");
                    return;
                }

                var div = "-----------------------------------\n";
                var empty = true;
                formattedOutput += result[0].TeamName + "\n" +
                "Core\n" + div;

                //cores loop
                for (var i = 0; i < result.length; i++) {
                   if (result[i].PlayStatus != 1 || result[i].FantasyRole != 1) {
                       continue;
                   }//8 for tag
                    formattedOutput+= result[i].PlayerID.toString().padStart(3," ") + " | ";
                    formattedOutput+= TabFormat(result[i].PlayerName.toString(),10) + " | ";
                    formattedOutput+= TabFormat(result[i].ProTeamTag.toString(),8) + " | ";
                    formattedOutput+= RoleName(result[i].FantasyRole).padEnd(7," ") + "\n";
                    empty = false;
                }

                if (empty) {
                    formattedOutput += "None\n";
                }
                else {
                    empty = true;
                }

                formattedOutput += "\n\n" +
                "Mid\n" + div;

                //mid loop
                for (var i = 0; i < result.length; i++) {
                    if (result[i].PlayStatus != 1 || result[i].FantasyRole != 4) {
                        continue;
                    }
                        formattedOutput+= result[i].PlayerID.toString().padStart(3," ") + " | ";
                        formattedOutput+= TabFormat(result[i].PlayerName.toString(),10) + " | ";
                        formattedOutput+= TabFormat(result[i].ProTeamTag.toString(),8) + " | ";
                        formattedOutput+= RoleName(result[i].FantasyRole).padEnd(7," ") + "\n";
                     empty = false;
                 }

                if (empty) {
                    formattedOutput += "None\n";
                }
                else {
                    empty = true;
                }

                 formattedOutput += "\n\n" +
                "Support\n" + div;

                //Support loop
                for (var i = 0; i < result.length; i++) {
                    if (result[i].PlayStatus != 1 || result[i].FantasyRole != 2) {
                        continue;
                    }
                        formattedOutput+= result[i].PlayerID.toString().padStart(3," ") + " | ";
                        formattedOutput+= TabFormat(result[i].PlayerName.toString(),10) + " | ";
                        formattedOutput+= TabFormat(result[i].ProTeamTag.toString(),8) + " | ";
                        formattedOutput+= RoleName(result[i].FantasyRole).padEnd(7," ") + "\n";
                     empty = false;
                 }

                if (empty) {
                    formattedOutput += "None\n";
                }
                else {
                    empty = true;
                }

                 formattedOutput += "\n\n" +
                "Bench\n" + div;

                //bench loop
                for (var i = 0; i < result.length; i++) {
                    if (result[i].PlayStatus != 0) {
                        continue;
                    }
                        formattedOutput+= result[i].PlayerID.toString().padStart(3," ") + " | ";
                        formattedOutput+= TabFormat(result[i].PlayerName.toString(),10) + " | ";
                        formattedOutput+= TabFormat(result[i].ProTeamTag.toString(),8) + " | ";
                        formattedOutput+= RoleName(result[i].FantasyRole).padEnd(7," ") + "\n";
                     empty = false;
                 }

                if (empty) {
                    formattedOutput += "None\n";
                }
                
                formattedOutput += "```";

                resolve(formattedOutput);

                connection.release();
                if (err) throw err;
            });
        });
    });

}

function FetchTeamRoster(userId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT Team.TeamName, ProTeam.ProTeamName, Player.PlayerID, Player.PlayerName, Player.AccountID, Player.FantasyRole, Player.PlayStatus FROM Player JOIN Team ON Player.FantasyTeamID = Team.TeamID JOIN Owner ON Team.OwnerID = Owner.OwnerID JOIN ProTeam ON Player.ProTeamID = ProTeam.ProTeamID WHERE Owner.OwnerName = " + userId, function (err, result, fields) {

                resolve(result);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function BenchPlayer(playerId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("UPDATE Player SET PlayStatus = 0 WHERE PlayerID = " + playerId, function (err, result, fields) {

                resolve("Player benched");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function UnBenchPlayer(playerId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("UPDATE Player SET PlayStatus = 1 WHERE PlayerID = " + playerId, function (err, result, fields) {

                resolve("Player set to active play");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function IsAtRosterLimit(roleId,roster) {

    var roleCount = 0;

    for (var i = 0; i < roster.length; i++) {
        if (roster[i].PlayStatus == 1 && roster[i].FantasyRole == roleId) {
            roleCount++;
        }
    }

    switch (roleId) {
        case (1):
            return (roleCount >= ROSTER_CORE_LIMIT);
        case (2):
            return (roleCount >= ROSTER_SUP_LIMIT);
        case (4):
            return (roleCount >= ROSTER_MID_LIMIT);
        default:
            return true;

    }

}

function PrintRequestList(userId) {

    return new Promise(async function (resolve, reject)
    {
        var formattedOutput = "```\n";

        let owners = await FetchOwners();

        TrashDBPool.getConnection(function (error, connection) {
            if (error)
                throw error;

            connection.query("SELECT RequestLogID, RequestID, OwnerID, SeasonID, DATE_FORMAT(RequestTime,'%Y-%m-%d %H:%i:%s') as RequestTime, RequestType, RequestedPlayers, GivenPlayers, RequestStatus FROM RequestLog WHERE SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1) AND RequestType IN (0,2) AND RequestStatus = 1 AND RequestTime >= (NOW() - INTERVAL 1 DAY) ORDER BY RequestLogID ASC", async function (err, result, fields) {


                formattedOutput += "Recently Completed\n";
                formattedOutput += "Time                |Owner                 |Type    |Pickups                      |Drops                       \n";
                formattedOutput += "---------------------------------------------------------------------------------------------------------------\n";

                if (result.length <= 0) {
                    formattedOutput += "None\n";
                }
                else {

                    for (var i = 0; i < result.length; i++) {
                        let reqType = (result[i].RequestType == 0) ? "Pickup" : "Drop";

                        let ownerName = "";

                        for (var x = 0; x < owners.length; x++) {
                            if (result[i].OwnerID == owners[x].OwnerID) {
                                ownerName = owners[x].OwnerName;
                                //console.log(ownerName);
                                break;
                            }
                        }
                        if (ownerName == "") {
                            ownerName = "NULL";
                        }
                        else {
                            let owner = await client.guilds.cache.get(SERVER_ID).members.fetch(ownerName);
                            ownerName = owner.displayName;
                        }

                        formattedOutput +=
                            result[i].RequestTime.toString() + " | " +
                            ownerName.padEnd(20, " ") + " | " +
                            reqType.padEnd(6, " ") + " | " +
                            ((result[i].RequestedPlayers != null) ?
                                result[i].RequestedPlayers.toString().padEnd(27, " ") : "None".padEnd(27, " ")) + " | " +
                            ((result[i].GivenPlayers != null) ?
                                result[i].GivenPlayers.toString().padEnd(27, " ") : "None") + "\n";
                    }

                }

                TrashDBPool.getConnection(function(error, connection) {
                    if (error) throw error;
                   
                    connection.query("SELECT RequestID,RequestedPlayerID,GivenPlayerID FROM Request WHERE OwnerID = (SELECT OwnerID FROM Owner WHERE OwnerName = '" +
                    userId + "') AND RequestType = 0 AND SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1)", function (err, result, fields) {
                        
                        
                        
                        formattedOutput += "\nYour Pending Requests\n";
                        formattedOutput += "ID  |Pickups                      |Drops                       \n";
                        formattedOutput += "---------------------------------------------------------------\n";
        
                        if (result.length <= 0)
                        {
                            formattedOutput += "None\n";
                        }
                        else {
                            for (var i = 0; i < result.length; i++) {
                                formattedOutput +=
                                    result[i].RequestID.toString().padStart(3," ") + " | " +
                                    result[i].RequestedPlayerID.toString().padEnd(27," ") + " | " +
                                    ((result[i].GivenPlayerID != null)?
                                    result[i].GivenPlayerID.toString().padEnd(27," ") : "None") + "\n";
                            }
                        }
        
                        formattedOutput += "```";
        
                        resolve(formattedOutput);
        
                        connection.release();
                        if (err) throw err;
                    });
                });



                connection.release();
                if (err)
                    throw err;
            });
        });

        
    });
    
}

function FetchOwners() {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            connection.query("SELECT Owner.OwnerID, OwnerName, TeamName FROM Owner JOIN Team ON Owner.OwnerID = Team.OwnerID WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1)", function (err, result, fields) {

                resolve(result);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function PrintRequestHistory(page) {

    var limit = 10;
        var offset = 0;
        offset = (page - 1) * limit;
        var formattedOutput = "```Page: " + page + "\n";

    return new Promise(async function (resolve, reject)
    {

        

        let owners = await FetchOwners();

        TrashDBPool.getConnection(function(error, connection) {
            
            
            connection.query("SELECT RequestLogID, RequestID, OwnerID, SeasonID, DATE_FORMAT(RequestTime,'%Y-%m-%d %H:%i:%s') as RequestTime, RequestType, RequestedPlayers, GivenPlayers, RequestStatus FROM RequestLog WHERE SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1) AND RequestType IN (0,2) ORDER BY RequestLogID ASC LIMIT " + offset + "," + limit, async function (err, result, fields) {
                
                formattedOutput += "Time                |Owner                 |Type    |Pickups                      |Drops                        |Status\n";
                formattedOutput += "-----------------------------------------------------------------------------------------------------------------------\n";

                
                if (result == null || result.length <= 0)
                {
                    formattedOutput += "None\n";
                }
                else {
                    for (var i = 0; i < result.length; i++) {
                        let reqType = (result[i].RequestType == 0)? "Pickup" : "Drop";

                        let ownerName = "";

                        for (var x = 0; x < owners.length; x ++) {
                            if (result[i].OwnerID == owners[x].OwnerID) {
                                ownerName = owners[x].OwnerName;
                                //console.log(ownerName);
                                break;
                            }
                        }
                        if (ownerName == "") {
                            ownerName = "NULL";
                        }
                        else {
                            let owner = await client.guilds.cache.get(SERVER_ID).members.fetch(ownerName);
                            ownerName = owner.displayName;
                        }


                        formattedOutput +=
                            result[i].RequestTime.toString() + " | " +
                            ownerName.padEnd(20," ") + " | " +
                            reqType.padEnd(6," ") + " | " +
                            ((result[i].RequestedPlayers != null)?
                            result[i].RequestedPlayers.toString().padEnd(27," ") : "None".padEnd(27," ")) + " | " +
                            ((result[i].GivenPlayers != null)?
                            result[i].GivenPlayers.toString().padEnd(27," ") : "None".padEnd(27," ")) + " | " +
                            RequestStatus(result[i].RequestStatus) + "\n";
                    }
                }

                formattedOutput += "```";

                resolve(formattedOutput);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function FetchPendingUserRequests(userId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            connection.query("SELECT RequestID,RequestedPlayerID,GivenPlayerID FROM Request WHERE OwnerID = (SELECT OwnerID FROM Owner WHERE OwnerName = '" +
            userId + "') AND RequestType = 0 AND SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1)", function (err, result, fields) {

                resolve(result);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function CancelRequest(reqId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("DELETE FROM Request WHERE RequestID = " + reqId, function (err, result, fields) {

                resolve("Request Cancelled");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function DenyTrade(reqId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("DELETE FROM Request WHERE RequestID = " + reqId, function (err, result, fields) {

                resolve("Trade Denied");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function AcceptTrade(trade,userId) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("UPDATE Player SET FantasyTeamID = (SELECT TeamID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE Owner.OwnerID = " + trade.OwnerID +
                ") WHERE PlayerID IN (" + trade.RequestedPlayerID.toString().replace('-',',') + "); \
                UPDATE Player SET FantasyTeamID = (SELECT TeamID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE Owner.OwnerName = '" + userId +
                "') WHERE PlayerID IN (" + trade.GivenPlayerID.toString().replace('-',',') + "); \
                INSERT INTO RequestLog (RequestID,OwnerID,SeasonID,RequestTime,RequestType,RequestedPlayers,GivenPlayers,TradeOwner,RequestStatus) VALUES (" + trade.RequestID + "," +
                trade.OwnerID + ",(SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1), NOW(),1," + trade.RequestedPlayerID + "," + trade.GivenPlayerID +
                ",(SELECT OwnerID FROM Owner WHERE OwnerName = '" + userId + "'),1); \
                DELETE FROM Request WHERE RequestID = " + trade.RequestID, function (err, result, fields) {

                resolve("Trade Accepted and Enacted");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function DropPlayers(drops) {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("UPDATE Player SET FantasyTeamID = 0 WHERE PlayerID IN (" + drops.join(",") + ")", function (err, result, fields) {

                resolve("Players dropped");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function SubmitRequest(userId,pickups,drops) {
    return new Promise(function (resolve, reject)
    {
        let dropFormat = (drops.length > 0)? ("'"+ drops.join("-") + "'") : ("NULL");
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("INSERT INTO Request (OwnerID,SeasonID,RequestType,RequestedPlayerID,GivenPlayerID) VALUES((SELECT OwnerID FROM Owner WHERE OwnerName = '" +
            userId + "'), (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1),0,'" + pickups.join("-") + "'," + dropFormat + ")" , function (err, result, fields) {

                resolve("Request Submitted");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function VerifyPickups(pickups) {
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT PlayerID FROM Player WHERE FantasyTeamID = 0 AND PlayerID IN (" + pickups.join(",") + ")" , function (err, result, fields) {

                if (result == null || pickups == null)
                {
                    resolve(false);
                    return;
                }
                if (result.length == pickups.length) {
                    resolve(true);
                }
                else {
                    resolve(false);
                }

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function SubmitDropLog(userId,drops) {
    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;
        connection.query("INSERT INTO RequestLog (RequestID,OwnerID,SeasonID,RequestTime,RequestType,GivenPlayers,TradeOwner,RequestStatus) VALUES (0,(SELECT OwnerID FROM Owner WHERE OwnerName = '" +
        userId + "'),(SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1), NOW(),2," + drops.join("-") + ",0,1)" , function (err, result, fields) {

            
            connection.release();
            if (err) throw err;
        });
    });
}

function FetchRosters() {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            connection.query("SELECT Owner.OwnerName, Owner.OwnerID, Team.TeamName, Player.PlayerID, Player.PlayerName, Player.FantasyRole, Player.PlayStatus, ProTeam.ProTeamName FROM \
                Player \
                JOIN Team ON Player.FantasyTeamID = Team.TeamID \
                JOIN Owner ON Team.OwnerID = Owner.OwnerID \
                JOIN ProTeam ON Player.ProTeamID = ProTeam.ProTeamID \
                WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1)", function (err, result, fields) {

                resolve(result);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function FetchMatchups() {
    return new Promise(function (resolve, reject)
    {

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            connection.query("SELECT Matchup.MatchupID, Matchup.TeamA_ID, Matchup.TeamB_ID,A.OwnerID as 'TeamA_Owner',A2.OwnerName as 'TeamA_OwnerName', B.OwnerID as 'TeamB_Owner',B2.OwnerName as 'TeamB_OwnerName', A.TeamName as 'TeamA_Name', B.TeamName as 'TeamB_Name', \
                Matchup.Date FROM Matchup LEFT JOIN Team as A ON Matchup.TeamA_ID = A.TeamID LEFT JOIN Team as B ON Matchup.TeamB_ID = B.TeamID LEFT JOIN Owner as A2 ON A.OwnerID = A2.OwnerID LEFT JOIN Owner B2 ON B.OwnerID = B2.OwnerID \
                WHERE Matchup.SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1) ORDER BY Matchup.Date ASC", function (err, result, fields) {

                resolve(result);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function PrintScores(userId,all) {

    

    return new Promise(async function (resolve, reject)
    {
        var formattedOutput = "```";

        //let rosters = await FetchRosters();
        let matchups = await FetchMatchups();
        if (matchups == null || matchups.length <= 0) {
            resolve(null);
            return;
        }

        var lastMatchup = null;
        var nextMatchup = null;

        for (var i = 0; i < matchups.length; i++) {
            if (matchups[i].Date != lastMatchup && Date.parse(matchups[i].Date) < Date.now()) {
                lastMatchup = matchups[i].Date;
            }
            else if (Date.parse(matchups[i].Date) > Date.now()) {
                nextMatchup = matchups[i].Date;
                break;
            }
        }

        

        var futureMatchup = false;
        if (lastMatchup == null || !RosterLocked()) {
            if (nextMatchup == null) {
                resolve("No current matchups");
                return;
            }
            futureMatchup = true;
            formattedOutput += "\nDisplaying next upcomming.\n";
        }
        
        var targetDate = (!futureMatchup)? lastMatchup : nextMatchup;
        console.log("matchupdate: " + new Date(Date.parse(targetDate) - 25200000).toISOString());
        formattedOutput += "\n" + targetDate + ":\n";

        var currentMatchups = new Array();

        for (var i = 0; i < matchups.length; i++) {
            
            if (matchups[i].Date.toString() == targetDate.toString()) {
                if (!all && matchups[i].TeamA_OwnerName != userId && matchups[i].TeamB_OwnerName != userId) {
                    continue;
                }
                currentMatchups.push(matchups[i]);
            }
        }

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            
            connection.query("SELECT Team.TeamName, Team.OwnerID, Team.TeamID, Player.PlayerName, ProTeam.ProTeamTag, \
            SUM(ROUND((0.3 * Result.Kills + (3 - 0.3 * Result.Deaths) + 0.003 * (Result.LastHits + Result.Denies) + \
            0.002 * Result.GPM + Result.Tower + Result.Rosh + 3 * Result.Participation + 0.5 * Result.Observers + 0.5 * \
            Result.Stacks + 0.25 * Result.Runes + 4 * Result.FirstBloods + 0.05 * Result.Stun), 1)) as 'Points', \
            COUNT(Result.ResultID) as 'Result Rows' FROM Team JOIN \
            Player ON Team.TeamID = Player.FantasyTeamID JOIN \
            ProTeam ON Player.ProTeamID = ProTeam.ProTeamID JOIN \
            Result ON Player.AccountID = Result.PlayerID \
            WHERE Result.MatchDate > '" + new Date(Date.parse(targetDate)- 25200000).toISOString() + "' AND \
            Player.PlayStatus = 1 AND \
            Team.SeasonID = 3 \
            GROUP BY Player.PlayerID", function (err, result, fields) {
                
                
                for (var i = 0; i < currentMatchups.length;i++) {
                    var bye = (currentMatchups[i].TeamB_ID == 0);
                    var teamAPt = 0;
                    var teamBPt = 0;
                    //console.log(result.length);
                    for (var j = 0; j < result.length; j++) {
                        //console.log(result[j].TeamID.toString() + "|" + currentMatchups[i].TeamA_ID.toString() + "|" + currentMatchups[i].TeamB_ID.toString() + "|" + Number(result[j].Points).toString());
                        if (result[j].TeamID.toString() == currentMatchups[i].TeamA_ID.toString()) {
                            teamAPt += Number(result[j].Points);
                        }
                        if (result[j].TeamID.toString() == currentMatchups[i].TeamB_ID.toString()) {
                            teamBPt += Number(result[j].Points);
                        }
                    }

                    formattedOutput += "\n" + currentMatchups[i].TeamA_Name + ": " + teamAPt.toFixed(2) + " vs " + ((!bye) ? currentMatchups[i].TeamB_Name : "BYE") + ": " + teamBPt.toFixed(2) + "\n";
                   
                }

                formattedOutput += "```";

                
                resolve(formattedOutput);
                connection.release();
                if (err) throw err;
            });
        });


        

        
    });

}



function PrintTradeList(userId) {
    
    return new Promise(async function (resolve, reject)
    {
        var formattedOutput = "```\n";

        let rosters = await FetchRosters();

        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            connection.query("SELECT Request.RequestID, Request.OwnerID, DATE_FORMAT(Request.RequestTime,'%Y-%m-%d %H:%i:%s') as RequestTime, Request.RequestedPlayerID, Request.GivenPlayerID, Owner.OwnerName FROM Request \
                JOIN Owner ON Request.OwnerID = Owner.OwnerID \
                WHERE RequestType = 1 \
                AND SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1)", async function (err, result, fields) {
                
                
                if (result.length <= 0)
                {
                    formattedOutput += "None\n";
                }
                else {
                    for (var i = 0; i < result.length; i++) {

                        let tradeStatus = "RECEIVED";
                        if (result[i].OwnerName == userId) {
                            tradeStatus = "SENT";
                        }
                        else {
                            let recipient = await FetchTradeRecipient(result[i].RequestedPlayerID.toString().split('-'));
                            if (recipient != userId) {
                                continue;
                            }
                        }

                        let reqs = result[i].RequestedPlayerID.toString().split('-');
                        let given = result[i].GivenPlayerID.toString().split('-');

                        let reqsNames = new Array();
                        let givenNames = new Array();

                        for (var x = 0;x < rosters.length;x++) {
                            for (var j = 0; j < reqs.length; j++) {
                                if (reqs[j] == rosters[x].PlayerID) {
                                    reqsNames.push(rosters[x].PlayerName);
                                }
                                if (given[j] == rosters[x].PlayerID) {
                                    givenNames.push(rosters[x].PlayerName);
                                }
                            }
                        }

                        formattedOutput +=
                            
                            result[i].RequestID.toString().padStart(3," ") + " | " +
                            tradeStatus.padEnd(8," ") + " | " +
                            result[i].RequestTime.toString() + " | " +
                            reqsNames.join(", ") + " for " +
                            givenNames.join(", ") +
                            "\n";
                    }
                }

                formattedOutput += "```";

                resolve(formattedOutput);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function FetchTradeList() {
    
    return new Promise(async function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            
            connection.query("SELECT Request.RequestID, Request.OwnerID, DATE_FORMAT(Request.RequestTime,'%Y-%m-%d %H:%i:%s') as RequestTime, Request.RequestedPlayerID, Request.GivenPlayerID, Owner.OwnerName FROM Request \
                JOIN Owner ON Request.OwnerID = Owner.OwnerID \
                WHERE RequestType = 1 \
                AND SeasonID = (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1)", async function (err, result, fields) {
                
                
                
                resolve(result);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function VerifyTradePickups(pickups) {
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT FantasyTeamID, PlayStatus FROM Player WHERE PlayerID IN (" +
            + pickups.join(",") + ")" , function (err, result, fields) {

                if (result.length <= 0 || result.length != pickups.length)
                {
                    resolve(false);
                }
                else {
                    let team = result[0].FantasyTeamID;
                    let invalid = false;
                    for (var i = 0; i < result.length; i++) {
                        if (result[i].FantasyTeamID != team || result[i].PlayStatus != 0) {
                            resolve(false);
                            invalid = true;
                            break;
                        }
                    }
                    if (!invalid) {
                        resolve(true);
                    }

                }

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function FetchTradeRecipient(pickups){
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("SELECT OwnerName FROM Owner \
            JOIN Team ON Owner.OwnerID = Team.OwnerID \
            JOIN Player ON Team.TeamID = Player.FantasyTeamID \
            WHERE PlayerID IN (" +
            + pickups.join(",") + ") LIMIT 1" , function (err, result, fields) {

                resolve(result[0].OwnerName);

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function SubmitTradeRequest(userId,pickups,given) {
    return new Promise(function (resolve, reject)
    {
        TrashDBPool.getConnection(function(error, connection) {
            if (error) throw error;
            connection.query("INSERT INTO Request (OwnerID,SeasonID,RequestType,RequestedPlayerID,GivenPlayerID) VALUES((SELECT OwnerID FROM Owner WHERE OwnerName = '" +
            userId + "'), (SELECT SeasonID FROM Season ORDER BY SeasonID DESC LIMIT 1),1,'" + pickups.join("-") + "','" + given.join("-") + "')" , function (err, result, fields) {

                resolve("Request Submitted");

                connection.release();
                if (err) throw err;
            });
        });
    });
}

function shuffle(a) {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

function RoleName(roleId) {
    var role;
    switch(roleId) {
        case (1):
            role = "Core";
            break;
        case (2):
            role = "Support";
            break;
        case (4):
            role = "Mid";
            break;
        default:
            role = "Unknown";
            break;

    }
    return role;
}

function RequestStatus(statusId) {
    var status;
    switch(statusId) {
        case (0):
            status = "Unknown";
            break;
        case (1):
            status = "Success";
            break;
        case (2):
            status = "Request failed - Team full";
            break;
        case (3):
            status = "Request failed - Player unavailable";
            break;
        default:
            status = "Error - Status unavailable";
            break;
    }
    return status;
}

async function SendPM(recipient,notification) {
    client.users.fetch(recipient).then((userRef) => {
        userRef.send(notification);
    });
}

async function DiscordLog(msg) {
    console.log(msg);
    client.guilds.fetch(SERVER_ID).then((guildRef) => {
        guildRef.channels.fetch(OUTPUT_CHANNEL).then((channelRef) => {
            channelRef.send(msg);
        });
    });
}

function TabFormat(text,length) {
    return text.substring(0,length).padEnd(length," ");
}

function RosterLocked() {
    var hours = new Date().getHours();
    var min = new Date().getMinutes();
    if (!ROSTER_FORCEOPEN && (ROSTER_FORCELOCK || (hours > ROSTER_LOCK_START_H || (hours == ROSTER_LOCK_START_H && min >= ROSTER_LOCK_START_M)) ||
    ((hours < ROSTER_LOCK_END_H) || hours == ROSTER_LOCK_END_H && min <= ROSTER_LOCK_END_M))) {
        return true;
    }
    return false;
}
