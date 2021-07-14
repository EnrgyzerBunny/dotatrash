const Discord = require('discord.js');
const fs = require("fs");
const mysql = require('mysql');

const client = new Discord.Client();
const token = require("./token.json")
const guild_id = require("./guild.json");
const { off } = require('process');

//server refs
const SERVER_ID = '220670947479257088';

//hacky enums
const DRAFT_MODE_OFF = 0;
const DRAFT_MODE_INIT = 1;
const DRAFT_MODE_MAIN = 2;
const DRAFT_MODE_RESOLVE = 3;

//mode vars
var DRAFT_MODE = DRAFT_MODE_OFF;

var DRAFT_ORDER = null;
var DRAFT_TURN_INDEX = -1;
var DRAFT_ROUNDS_LIMIT = 7; //How many draft rounds
var DRAFT_ROUNDS_COUNT = 0;
var DRAFT_CURRENT_PICK = null;
var DRAFT_INIT_TIMER = 5; //in min
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

//DB refrence
/*const TrashDB = mysql.createConnection({
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider"
});

TrashDB.connect();*/

//DB pooling
const TrashDBPool = mysql.createPool({
    connectionLimit: 10,
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider"

});
console.log("TrashDBPool Created.");



process.on("unhandledRejection", error => console.error("Promise rejection:", error));

client.on('ready', () => {

    console.log("Client Initiated.");

    /*
    //Discord Guild Level Command Registration ---------------------------------------------------
    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "teams",
            description: "list season teams"
            // possible options here e.g. options: [{...}]
        }
    });

    
    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "join",
            description: "Join the Dota Trash league"
            // possible options here e.g. options: [{...}]
        }
    });

    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "createteam",
            description: "Create a team for the current season"
            // possible options here e.g. options: [{...}]
        }
    });
    */

    //Discord Global Level Command Registration ---------------------------------------------------

    /* -- command registration should be maintained at API level and not called by bot
    client.api.applications(client.user.id).commands.post({
        data: {
            name: "join",
            description: "Join the Dota Trash league"
            // possible options here e.g. options: [{...}]
        }
    });

    client.api.applications(client.user.id).commands.post({
        data: {
            name: "createteam",
            description: "Create a team for the current season",
            // possible options here e.g. options: [{...}]
            options: [
                {
                    name: "name",
                    description: "Name of team",
                    type: 3,
                    required: true
                }
            ]
        }
    });
*/ 

    client.ws.on('INTERACTION_CREATE', async interaction => {
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
            PullTeams(interaction.id, interaction.token);
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
    });
});

client.login(token.token);

function PullTeams(interactionid, interactiontoken)
{
    TrashDBPool.getConnection(function(error, connection) {
        if (error) throw error;

        connection.query("SELECT * FROM Team", function (err, result, fields) {
            
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
    
    
    //console.log("Connected to TrashDB.");
    
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
                
                console.log(JSON.stringify(result));
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
                
                console.log(JSON.stringify(result));
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
    }

    if (DRAFT_ROUNDS_COUNT >= DRAFT_ROUNDS_LIMIT) {
        //Draft over
        DRAFT_MODE = DRAFT_MODE_RESOLVE;

        client.guilds.cache.get(guild_id).channels.cache.get(channel_id).send("```//TODO: End of Draft Function```");
        //TODO: call end of draft func
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
                    formattedOutput+= result[i].PlayerName.toString().padStart(15," ") + " | ";
                    formattedOutput+= result[i].ProTeamName.toString().padStart(16," ") + " | ";

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

                    formattedOutput+= role.toString().padStart(7," ") + "\n";
                    

                    
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
            connection.query("SELECT TeamName, OwnerName, Owner.OwnerID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE Team.SeasonID = (SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1)", function (err, result, fields) {
                
                for (var i = 0; i < result.length; i++) {
                    let userTeam = {
                        user: result[i].OwnerName,
                        team: result[i].TeamName,
                        ownerID: result[i].OwnerID,
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
