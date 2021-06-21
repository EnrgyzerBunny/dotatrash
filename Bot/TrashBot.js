const Discord = require('discord.js');
const fs = require("fs");
const mysql = require('mysql');

const client = new Discord.Client();
const token = require("./token.json")
const guild_id = require("./guild.json")

//server refs
const SERVER_ID = '220670947479257088';

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
const TrashDB = mysql.createConnection({
    host: "localhost",
    user: "trashbot",
    password: "password",
    database: "EnrgyzerBunny_Collider"
});

TrashDB.connect();
console.log("TrashDB Connected.");



process.on("unhandledRejection", error => console.error("Promise rejection:", error));

client.on('ready', () => {

    console.log("Client Initiated.");

    
    //Discord Guild Level Command Registration ---------------------------------------------------
    client.api.applications(client.user.id).guilds(guild_id.id).commands.post({
        data: {
            name: "teams",
            description: "list season teams"
            // possible options here e.g. options: [{...}]
        }
    });

    /*
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
    });
});

client.login(token.token);

function PullTeams(interactionid, interactiontoken)
{
    
    
    TrashDB.query("SELECT * FROM Team", function (err, result, fields) {
        if (err) throw err;
        console.log(JSON.stringify(result));

        let ouput = "```\n";

        for (var i = 0; i < result.length;i++)
        {
            ouput += result[i].TeamName + " | Season " + (Number(result[i].SeasonID) + 1) + "\n";
        }

        ouput += "```";


        client.api.interactions(interactionid, interactiontoken).callback.post({
            data: {
                type: 4,
                data: {
                    content: ouput
                }
            }
        });
        //TrashDB.end();

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

    TrashDB.query("INSERT INTO Owner(OwnerName) VALUES ('" + userId + "')", function (err, result, fields) {
        if (err) throw err;
        console.log(JSON.stringify(result));
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
        TrashDB.query("SELECT SeasonID FROM Season ORDER BY isActive DESC LIMIT 1", function (err, result, fields) {
            if (err) throw err;
            console.log(JSON.stringify(result));
            resolve(Number(result[0].SeasonID));
        });

    });
}

function HasTeam(userId, currentSeason)
{
    return new Promise(function (resolve, reject)
    {
        TrashDB.query("SELECT TeamID, SeasonID FROM Team JOIN Owner ON Team.OwnerID = Owner.OwnerID WHERE OwnerName = '" + userId + "' ORDER BY SeasonID DESC LIMIT 1", function (err, result, fields) {
            if (err) throw err;
            console.log(JSON.stringify(result));
            if (result.length == 0){
                resolve(false);
            }
            else
                resolve(Number(result[0].SeasonID) == currentSeason);
        });

    });
}

function CreateTeam(ownerName, season, teamName){
    
    TrashDB.query("INSERT INTO Team(TeamName,SeasonID,OwnerID) SELECT '" + teamName + "', '" + season + "', OwnerID FROM Owner WHERE OwnerName = '" + ownerName + "'", function (err, result, fields) {
        if (err) throw err;
        console.log(JSON.stringify(result));
    });
}

