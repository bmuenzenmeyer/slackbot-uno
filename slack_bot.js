const Slapp = require('slapp');
const ConvoStore = require('slapp-convo-beepboop');
const BeepBoopContext = require('slapp-context-beepboop');
const Express = require('express');

var port = process.env.PORT || 8080;

var slapp = Slapp({
    convo_store: ConvoStore(),
    context: BeepBoopContext(),
    log: true,
    colors: true
});

var storage = require('botkit-storage-redis')({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
        methods: ['hands']
    }),
    Promise = require('bluebird');

Promise.promisifyAll(storage.channels);
Promise.promisifyAll(storage.users);

var unoGame = require('./lib/uno.js')({
        storage: storage
    });


//------------Main code begins here-----------------

//TODO: Allow for commands via @mentions as well

slapp.command('/uno', '^new$', (msg) => {
    unoGame.getGame(msg, true).then(function(game){
        unoGame.initializeGame(msg, game);
    });
});

//The following should hear most combinations of cards that can be played
//TODO: Consider breaking these out into seperate functions for easier debugging
slapp.command('/uno', '^play(?: (r(?:ed)?|y(?:ellow)?|g(?:reen)?|b(?:lue)?|w(?:ild)?|d(?:raw ?4)?)(?: ?([1-9]|s(?:kip)?|r(?:everse)?|d(?:(?:raw ?)?2?)?))?)?$', (msg, text, color, value) => {
    unoGame.getGame(msg).then(function(game){
        unoGame.playCard(msg, game, color, value);
    });
});

slapp.command('/uno', '^color (r(?:ed)?|y(?:ellow)?|g(?:reen)?|b(?:lue)?)', (msg, text, color) => {
    unoGame.getGame(msg).then(function(game){
        unoGame.setWildColor(msg, game, color);
    });
});

//TODO: Remove when done testing (or not)
slapp.command('/uno', '^reset thisisthepassword$', (msg) => {
    unoGame.getGame(msg, true).then(function(game){
        unoGame.resetGame(msg, game);
    });
});

slapp.command('/uno', '^setup', (msg) => {
    unoGame.getGame(msg).then(function(game){
        for (var i = 2; i <= 2; i++){
            var mockUser = 'Player' + i;
            unoGame.joinGame(msg, game, mockUser);
        }
    });
});

slapp.command('/uno', '^join', (msg) => {
    unoGame.getGame(msg).then(function(game){
        unoGame.joinGame(msg, game);
    });
});

slapp.command('/uno', '^quit', (msg) => {
    unoGame.getGame(msg).then(function(game){
        unoGame.quitGame(msg, game);
    });
});

slapp.command('/uno', '^status', (m) => {
    unoGame.getGame(m).then(function(g){
        unoGame.reportHand(m, g);
        unoGame.reportTurnOrder(m, g, true);
        unoGame.reportScores(m, g, true);
    });
});

slapp.command('/uno', '^start', (m) => {
    unoGame.getGame(m).then(function(g){
        unoGame.beginGame(m, g);
    });
});

slapp.command('/uno', '^draw', (m) => {
    unoGame.getGame(m).then(function(g){
        unoGame.drawCard(m, g);
    });
});

slapp.command('/uno', '^pass', (m) => {
    m.respond('I\'m sorry, Dave, I\'m afraid I can\'t let you do that.');
});



/*
controller.hears(['^test$'], ['slash_command'], function(bot, message){
    bot.replyInteractive(message, {
        text: 'What would you like to do?',
        attachments: [
            {
                text: 'Choose an action.',
                callback_id: 'test_callback',
                attachment_type: 'default',
                actions: [
                    {
                        name: 'draw',
                        text: 'draw',
                        value: 'draw',
                        type: 'button'
                    }]
            }]
    });
});


controller.hears(['^draw$'], ['interactive_message_callback'], function(bot, message){
    var botInfo = {bot, message};
    getGame(botInfo, false, true).then(function(game){
        drawCard(botInfo, game);
    });
});
*/


//------- Game code begins here ------------//

/*
function announceTurn(message, game){
    if (!game){
        return;
    }

    sendMessage(message, {
        "text": 'The current up card is:',
        "attachments": [{            
            "color": colorToHex(game.currentCard.color),
            "text": game.currentCard.color + ' ' + game.currentCard.value        
        }]
    });
    
    sendMessage(message, 'It is ' + game.turnOrder[0] + '\'s turn.\nType `/uno play [card]`, `/uno draw` or `/uno status` to begin your turn.');
}

function getNewDeck(game){
    console.log('Generating new deck.');
    return request({
        uri: 'http://deckofcardsapi.com/api/deck/new/shuffle/?deck_count=2',
        json: true
    }).then(function(result){
        game.deckId = result.deck_id;
    });
}

function beginGame(message, game){
    if (!game){
        return;
    }

    var user = message.body.user_name;

    if (game.player1 !== user){
        sendMessage(message, 'Only player 1 (' + game.player1 + ') can start the game.', true);
        return;
    }

    if (Object.keys(game.players).length < 2){
        sendMessage(message, 'You need at least two players to begin playing.', true);
        return;
    }

    if (game.started){
        sendMessage(message, 'The game is already started.', true);
        reportTurnOrder(message, game, true);
        return;
    }

    game.started = true;
    var drawRequests = [];

    sendMessage(message, 'Game has started! Shuffling the deck and dealing the hands.');

    getNewDeck(game).then(function(){
        for (var playerName in game.players){
            var drawRequest = drawCards(message, game, playerName, 7);

            drawRequests.push(drawRequest);                    
        }
        
        //draw the starting card as well
        var startingCardRequest = request({
            uri: 'http://deckofcardsapi.com/api/deck/' + game.deckId + '/draw/?count=1',
            json: true
        }).then(function(result){            
            game.currentCard = getUnoCard(result.cards[0]);
            game.playAnything = game.currentCard.color === 'wild';
        });

        drawRequests.push(startingCardRequest);
    }).then(function(){
        Promise.all(drawRequests).then(function(){
            saveGame(game).then(function(){
                announceTurn(message, game);
                reportHand(message, game);
            });
        });
    });
}

function calculatePoints(game){
    if (!game){
        return 0;
    }

    var pointValues = {'wild': 50, 'draw 4': 50, 'draw 2': 20, 'skip': 20, 'reverse': 20};
    
    var total = 0;
    
    //Assume the first player in the turnOrder is the winner when calculating points
    for (var i = 1; i < game.turnOrder.length; i++){
        var playerName = game.turnOrder[i];
        var player = game.players[playerName];
        console.log('Calculating ' + playerName + ' hand score');
        
        var currentValue = 0;
        
        for (var j = 0; j < player.hand.length; j++){
            var card = player.hand[j];
            var value = pointValues[card.value] || Number(card.value);
            console.log(card.color + ' ' + card.value + ' = ' + value);
            currentValue += isNaN(value) ? 0 : value;
        }
        
        console.log(playerName + ' total: ' + currentValue);
        
        total += currentValue;
    }
    
    console.log('Total points: ' + total);
    
    return total;
}

function colorToHex(color){    
    switch(color){
        case 'blue': return '#0033cc';
        case 'red': return '#ff0000';
        case 'green': return '#006633';
        case 'yellow': return '#ffff00';
        case 'wild': return '#000000';
        default: return '';
    }
}

function drawCard(message, game){
    if (!game){
        return;
    }

    var playerName = message.body.user_name;

    if (!game.started){
        sendMessage(message, 'The game has not yet started.', true);
        return;
    }

    sendMessage(message, 'Drawing card', true);
    drawCards(message, game, playerName, 1).then(function(){
        sendMessage(message, playerName + ' has drawn a card.');
    }).then(function(){
        saveGame(game).then(function(){
            sendMessage(message, 'You now have ' + game.players[playerName].hand.length + ' cards.', true);
            reportHand(message, game);
        });
    });
}

function drawCards(message, game, playerName, count){
    if (!game){
        return;
    }

    console.log('Drawing ' + count + ' cards for ' + playerName);

    return request({
        uri: 'http://deckofcardsapi.com/api/deck/' + game.deckId,
        json: true
    }).catch(function(result){
        if (!result.success){
            console.log('Error drawing cards:');
            console.log(result.error);
            return getNewDeck(game);
        }
    }).then(function(promise){
        if (promise && promise.then){ //TODO: Improve on this;
            return promise.then(function(){
                return drawCards(message, game, playerName, count);
            });
        }
        
        return request({
            uri: 'http://deckofcardsapi.com/api/deck/' + game.deckId + '/draw/?count=' + count,
            json: true
        }).then(function(result){
            var player = game.players[playerName];
            var cardCount = result.cards.length;
    
            console.log('Drew ' + cardCount + ' cards, adding to ' + playerName + ' hand');
    
            for (var j = 0; j < cardCount; j++){
                var card = getUnoCard(result.cards[j]);
                player.hand.push(card);
            }
    
            console.log(playerName + ' hand at ' + player.hand.length + ' cards.');
            console.log(result.remaining + ' cards remaining in the deck.');
    
            if (result.remaining <= 10){
                sendMessage(message, 'Less than 10 cards remaining. Reshuffling the deck.');
                request({
                    uri: 'http://deckofcardsapi.com/api/deck/' + game.deckId + '/shuffle/',
                    json: true
                }).then(function(shuffleResult){
                    sendMessage(message, 'Deck reshuffled.');
                });
            }
        }).catch(function(err){
            console.log(err);
        });
    });
}

function endGame(message, game){
    if (!game){
        return;
    }
    
    var winner = game.turnOrder[0],
        points = calculatePoints(game);
    
    sendMessage(message, winner + ' played their final card.');
    sendMessage(message, winner + ' has won the hand, and receives ' + points + ' points.');

    endTurn(message, game);
    
    game.players[winner].points += points;
    
    var currentScores = [];
    
    for (var key in Object.keys(game.players)){
        var player = game.players[key];
        player.hand = [];
        currentScores.push({Name: key, Score: player.score ? player.score : 0 });
    }
    
    currentScores.sort(function(a, b){ return b.Score - a.Score; });
    
    reportScores(message, game);

    if (currentScores[0].Score >= 500){
        //Player won the game; reset the game to a 'new' state
        var gameWinner = currentScores[0];
        sendMessage(message, gameWinner.Name + ' has won the game with ' + gameWinner.Score + ' points!', true);
        
        game = newGame();
        game.id = message.meta.channel_id;
    } else {
        //Leave the game state, but mark as not started to trigger a new deal
        game.started = false;
        
        sendMessage(message, game.player1 + ', type `/uno start` to begin a new hand.', true);
    }
    
    saveGame(game);
}

function endTurn(message, game){
    if (!game){
        return;
    }

    if (!game.started){
        sendMessage(message, 'The game has not yet been started.', true);
        return;
    }

    console.log('Ending turn for ' + game.turnOrder[0]);
    game.turnOrder.push(game.turnOrder.shift());
}

function getGame(message, suppressNotice, isInteractive){
    var channel = message.meta.channel_id;

    return storage.channels.getAsync(channel).then(function(game){
        console.log('Game info retrieved for ' + channel);
        
        if (!game || !game.initialized){
            if (!suppressNotice){
                sendMessage(message, 'There is no game yet.', true);
            }
            
            console.log('No game or not initialized');
            return undefined;
        }
        
        return game;
    }).error(function(err){
        console.log(err);
        sendMessage(message, 'There was a problem retrieving the game.', true);
        return undefined;
    });
}

function getUnoCard(standardCard){
    var value = valueMappings[standardCard.value] || (standardCard.value - 1) + '',
        color = suitMappings[standardCard.suit];

    if (standardCard.value === 'ACE'){
        color = 'wild';
        switch (standardCard.suit){
            case 'CLUBS':
            case 'SPADES':
                value = 'wild';
                break;
            case 'HEARTS':
            case 'DIAMONDS':
                value = 'draw 4';
                break;
        }
    }

    return {
        color: color,
        value: value
    };
}

function initializeGame(message, game){
    var user = message.body.user_name;
    
    if (game && game.initialized){
        sendMessage(message, 'There is already an uno game in progress. Type `/uno join` to join the game.', true);
        return;
    }
        
    game = newGame();
    game.id = message.meta.channel_id;

    game.initialized = true;
    game.player1 = user;
    game.players[user] = {
        hand: []
    };
    game.turnOrder.push(user);

    sendMessage(message, user + ' has started UNO. Type `/uno join` to join the game.');

    saveGame(game).then(function(){
        reportTurnOrder(message, game, false);
    });

}

function joinGame(message, game, userName){
    var user = userName || message.body.user_name;

    if (!game){
        return;
    }

    if (game.turnOrder.indexOf(user) > 0){
        sendMessage(message, user + ' has already joined the game!', true);
        return;
    }

    if (game.players[user]){
        game.players[user].hand = [];
    } else {
        game.players[user] = {
            hand: []
        };
    }

    game.turnOrder.push(user);

    sendMessage(message, user + ' has joined the game.');
    
    saveGame(game).then(function(){
        reportTurnOrder(message, game, true);
    });

}

function newGame(){
    return {
        initialized: false,
        started: false,
        players: {},
        deckId: '',
        turnOrder: [],
        currentCard: {}
    };
}

function playCard(message, game, color, value){
    var playerName = message.body.user_name;

    if (!game){
        return;
    }

    if (!game.started){
        sendMessage(message, 'The game has not yet been started.', true);
        return;
    }

    var currentPlayer = game.turnOrder[0];

    if (playerName !== currentPlayer){
        sendMessage(message, 'It is not your turn.', true);
        return;
    }

    if (!color && !value){
        reportHand(message, game);
        sendMessage(message, 'You can perform the following actions:\n`/uno play [card]`, `/uno draw`, `/uno view`', true);
        return;
    }

    if (!/^(w(ild)?|d(raw ?4?)?)/i.test(color) && !value){
        sendMessage(message, 'You must specify the value of the card to be played.', true);
        return;
    }

    if (/^d(raw ?4)?/i.test(color)){
        color = 'wild';
        value = 'draw 4';
    } else if (/^w(ild)?/i.test(color)){
        color = 'wild';
        value = 'wild';
    }

    color = color.toLowerCase();
    value = value.toLowerCase();

    color = {'b': 'blue', 'y': 'yellow', 'g': 'green', 'r': 'red'}[color] || color;
    value = {'s': 'skip', 'r': 'reverse', 'draw2': 'draw 2', 'draw': 'draw 2', 'd2': 'draw 2', 'd': 'draw 2'}[value] || value;

    var player = game.players[playerName];

    var selectedCards = player.hand.filter(function(item){ return item.color === color && item.value === value; }); 

    if (selectedCards.length === 0){
        console.log(color + ' ' + value);
        sendMessage(message, 'You don\'t have a ' + (color !== 'wild' ? color + ' ' : '') + value, true);
        return;
    }

    var cardToPlay = selectedCards[0];


    if (!game.playAnything &&
        cardToPlay.color !== 'wild' && 
        cardToPlay.color !== game.currentCard.color &&
        (game.currentCard.value === 'wild' ||
        game.currentCard.value === 'draw 4' ||         
        cardToPlay.value !== game.currentCard.value)){
            sendMessage(message, 'You cannot play a ' + color + ' ' + value + ' on a ' + game.currentCard.color + ' ' + game.currentCard.value, true);
            return;
    }

    if (game.playAnything){
        game.playAnything = false;
    }

    player.hand.splice(player.hand.indexOf(cardToPlay), 1);
    game.currentCard = cardToPlay;

    if (cardToPlay.color === 'wild'){
        saveGame(game).then(function(){
            //TODO: Begin conversation and interactively prompt for color
            sendMessage(message, 'Type `/uno color [color]` to specify what the new color should be.', true);
        });
        return;
    }

    sendMessage(message, 'playing ' + cardToPlay.color + ' ' + cardToPlay.value, true);
    
    if (player.hand.length === 1){
        sendMessage(message, playerName + ' only has one card left in their hand!');
    } else if (player.hand.length === 0){
        endGame(message, game);
        return;
    }


    var asyncs = [];

    if (cardToPlay.value === 'skip'){
        endTurn(message, game);
        endTurn(message, game);
    } else if (cardToPlay.value === 'reverse'){
        game.turnOrder.reverse();
    } else if (cardToPlay.value === 'draw 2'){
        endTurn(message, game);
        asyncs.push(drawCards(message, game, game.turnOrder[0], 2)
            .then(function(){
                endTurn(message, game);
            }));
    } else{
        endTurn(message, game);
    }
    
    Promise.all(asyncs).then(function(){
        saveGame(game).then(function(){
            reportHand(message, game);
            sendMessage(message, playerName + ' played a ' + color + ' ' + value);
            announceTurn(message, game);
        });
    });
}

function quitGame(message, game){
    var user = message.body.user_name;
        
    if (!game){
        return;
    }

    if (!game.players[user]){
        sendMessage(message, 'You weren\'t playing to begin with.', true);
        return;
    }


    var player = game.turnOrder.indexOf(user);
    game.turnOrder.splice(player, 1);

    sendMessage(message, user + ' has left the game.');

    if (Object.keys(game.players).length === 0){
        game = newGame();
        saveGame(game).then(function(){
            sendMessage(message, 'No more players. Ending the game.');
        });
        
        return;
    }

    if (game.player1 === user){        
        game.player1 = Object.keys(game.players)[0];
        sendMessage(message, game.player1 + ' is the new player 1.');
    }

    if (Object.keys(game.players).length === 1){
        game.started = false;
        saveGame(game).then(function(){
            sendMessage(message, 'Only one player remaining. Waiting for more players.');
        });

        return;
    }

    saveGame(game).then(function(){
        reportTurnOrder(message, game);
    });
}

function reportCurrentCard(message, game, isPrivate){
    if (!game){
        return;
    }

    var msg = {
        "text": 'The current up card is:',
        "attachments": [{            
            "color": colorToHex(game.currentCard.color),
            "text": game.currentCard.color + ' ' + game.currentCard.value        
        }]
    };

    sendMessage(message, msg, isPrivate);
}

function reportHand(message, game){
    if (!game){
        return;
    }

    var playerName = message.body.user_name;


    if (!game.started){
        sendMessage(message, 'The game has not yet started.', true);
        return;
    }

    var player = game.players[playerName];

    var hand = [];

    for (var i = player.hand.length - 1; i >= 0; i--){
        var card = player.hand[i];
        hand.push({
            "color": colorToHex(card.color),
            "text": card.color + ' ' + card.value
        });        
    }

    sendMessage(message, {
            "text": 'Your current hand is:',
            "attachments": hand
        }, true);
}

function reportScores(message, game, isPrivate){
    if (!game){
        return;
    }
    
    var currentScores = [];
    
    var players = Object.keys(game.players);
    
    for (var i = 0; i < players.length; i++){
        var key = players[i];
        var player = game.players[key];
        player.hand = [];
        currentScores.push({Name: key, Score: player.score ? player.score : 0 });
    }
    
    currentScores.sort(function(a, b){ return b.Score - a.Score; });

    var stringified = '';
    
    for(var j = 0; j < currentScores.length; j++){
        stringified += '\n' + currentScores[j].Name + ': ' + currentScores[j].Score;
    }
    
    sendMessage(message, 'Current score:\n' + stringified, isPrivate);
}

function reportTurnOrder(message, game, isPrivate){
    if (!game){
        return;
    }
    
    if (game.started){
        reportCurrentCard(message, game, isPrivate);
    }

    var currentOrder = '';

    for (var i = 1; i < game.turnOrder.length + 1; i++){
        if (i > 1){
            currentOrder = currentOrder + ', ';
        }
        var playerName = game.turnOrder[i - 1],
            cardReport = '';

        if (game.started){
            cardReport = ' (' + game.players[playerName].hand.length + ' cards)';
        }

        currentOrder = currentOrder + '\n' + i + '. ' + playerName + cardReport; 
    }

    sendMessage(message, 'Current playing order:\n' + currentOrder, isPrivate);
}

function resetGame(message, game){
    game = newGame();
    game.id = message.meta.channel_id;
    saveGame(game).then(function(){
        sendMessage(message, 'Game for this channel reset.', true);
    });
}

function saveGame(game){
    console.log('Saving game ' + game.id);
    
    return storage.channels.saveAsync(game).then(function(){
        console.log(game.id + ' saved.');
    }).catch(function(err){
        return err;
    });
}

function sendMessage(message, text, isPrivate){
    if (isPrivate){
        message.respond(text);
    } else{
        message.say(text);
    }
}

function setWildColor(message, game, color){
    if (!game){
        return;
    }

    var playerName = message.body.user_name;

    if (!game.started){
        sendMessage(message, 'The game has not yet been started.', true);
        return;
    }

    var currentPlayer = game.turnOrder[0];

    if (playerName !== currentPlayer)
    {
        sendMessage(message, 'It is not your turn.', true);
        return;
    }

    if (game.currentCard.color !== 'wild'){
        sendMessage(message, 'You have\'t played a wild.', true);
        return;
    }


    color = color.toLowerCase();
    
    color = {'b': 'blue', 'y': 'yellow', 'g': 'green', 'r': 'red'}[color] || color;

    sendMessage(message, 'Setting the color to ' + color, true);

    game.currentCard.color = color;

    sendMessage(message, playerName + ' played a ' + game.currentCard.value + ' and chose ' + message + ' as the new color.');

    endTurn(message, game);
    
    var asyncs = [];

    if (game.currentCard.value === 'draw 4'){
        asyncs.push(drawCards(message, game, game.turnOrder[0], 4).then(function(){
            endTurn(message, game);
        }));
    }
    
    Promise.all(asyncs).then(function(){
        saveGame(game).then(function(){
            reportHand(message, game);
            announceTurn(message, game);
        });
    });

}
*/

// attach Slapp to express server
var server = slapp.attachToExpress(Express());

// start http server
server.listen(port, (err) => {
  if (err) {
    return console.error(err);
  }

  console.log(`Listening on port ${port}`);
})