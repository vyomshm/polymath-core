const duration = {
  seconds: function (val) { return val; },
  minutes: function (val) { return val * this.seconds(60); },
  hours: function (val) { return val * this.minutes(60); },
  days: function (val) { return val * this.hours(24); },
  weeks: function (val) { return val * this.days(7); },
  years: function (val) { return val * this.days(365); },
};
var readlineSync = require('readline-sync');
var chalk = require('chalk');
var moment = require('moment');
var common = require('./common/common_functions');
var global = require('./common/global');
var contracts = require('./helpers/contract_addresses');
var abis = require('./helpers/contract_abis');

const MODULES_TYPES = {
  PERMISSION: 1,
  TRANSFER: 2,
  STO: 3,
  DIVIDENDS: 4,
  BURN: 5
}

// App flow
let tokenSymbol;
let securityToken;
let polyToken;
let securityTokenRegistry;
let generalTransferManager;
let currentDividendsModule;

async function executeApp(type, remoteNetwork) {
  dividendsType = type;
  await global.initialize(remoteNetwork);

  common.logAsciiBull();
  console.log("**********************************************");
  console.log("Welcome to the Command-Line Dividends Manager.");
  console.log("**********************************************");
  console.log("Issuer Account: " + Issuer.address + "\n");

  await setup();
  try {
    await start_explorer();
  } catch (err) {
    console.log(err);
    return;
  }
};

async function setup(){
  try {
    let securityTokenRegistryAddress = await contracts.securityTokenRegistry();
    let securityTokenRegistryABI = abis.securityTokenRegistry();
    securityTokenRegistry = new web3.eth.Contract(securityTokenRegistryABI, securityTokenRegistryAddress);
    securityTokenRegistry.setProvider(web3.currentProvider);

    let polyTokenAddress = await contracts.polyToken();
    let polyTokenABI = abis.polyToken();
    polyToken = new web3.eth.Contract(polyTokenABI, polyTokenAddress);
    polyToken.setProvider(web3.currentProvider);
  } catch (err) {
    console.log(err)
    console.log('\x1b[31m%s\x1b[0m',"There was a problem getting the contracts. Make sure they are deployed to the selected network.");
    process.exit(0);
  }
}

async function start_explorer(){
  console.log('\n\x1b[34m%s\x1b[0m',"Dividends Manager - Main Menu");

  if (!tokenSymbol)
    tokenSymbol = readlineSync.question('Enter the token symbol: ');

  let result = await securityTokenRegistry.methods.getSecurityTokenAddress(tokenSymbol).call();
  if (result == "0x0000000000000000000000000000000000000000") {
    tokenSymbol = undefined;
    console.log(chalk.red(`Token symbol provided is not a registered Security Token.`));
  } else {
    let securityTokenABI = abis.securityToken();
    securityToken = new web3.eth.Contract(securityTokenABI,result);

    // Get the GTM
    result = await securityToken.methods.getModulesByName(web3.utils.toHex('GeneralTransferManager')).call();
    if (result.length == 0) {
      console.log(chalk.red(`General Transfer Manager is not attached.`));
    } else {
      generalTransferManagerAddress = result[0];
      let generalTransferManagerABI = abis.generalTransferManager();
      generalTransferManager = new web3.eth.Contract(generalTransferManagerABI, generalTransferManagerAddress);
      generalTransferManager.setProvider(web3.currentProvider);

      let typeOptions = ['POLY', 'ETH'];
      if (!typeOptions.includes(dividendsType)) {
        let index = readlineSync.keyInSelect(typeOptions, 'What type of dividends do you want work with?', {cancel: false});
        dividendsType = typeOptions[index];
        console.log(`Selected: ${dividendsType}`)
      }

      let currentCheckpoint = await securityToken.methods.currentCheckpointId().call();
      console.log(chalk.yellow(`\nToken is at checkpoint: ${currentCheckpoint}`));

      let options = ['Mint tokens', 'Transfer tokens', 'Create checkpoint', 'Set default exclusions for dividends', 'Tax holding settings', 'Create dividends']

      if (currentCheckpoint > 0) {
        options.push('Explore account at checkpoint', 'Explore total supply at checkpoint')
      }

      // Only show dividend options if divididenModule is already attached
      if (await isDividendsModuleAttached()) {
        options.push('Push dividends to accounts',
          `Explore ${dividendsType} balance`, 'Reclaim expired dividends')
      }

      let index = readlineSync.keyInSelect(options, 'What do you want to do?');
      let selected = index != -1 ? options[index] : 'Cancel';
      console.log('Selected:', selected, '\n');
      switch (selected) {
        case 'Mint tokens':
          let _to =  readlineSync.question('Enter beneficiary of minting: ');
          let _amount =  readlineSync.question('Enter amount of tokens to mint: ');
          await mintTokens(_to,_amount);
        break;
        case 'Transfer tokens':
          let _to2 =  readlineSync.question('Enter beneficiary of tranfer: ');
          let _amount2 =  readlineSync.question('Enter amount of tokens to transfer: ');
          await transferTokens(_to2,_amount2);
        break;
        case 'Create checkpoint':
          let createCheckpointAction = securityToken.methods.createCheckpoint();
          await common.sendTransaction(Issuer, createCheckpointAction, defaultGasPrice);
        break;
        case 'Set default exclusions for dividends':
          await setDefaultExclusions();
        break;
        case 'Tax holding settings':
          await taxHoldingMenu();
        break;
        case 'Create dividends':
          let divName = readlineSync.question(`Enter a name or title to indetify this dividend: `);
          let dividend = readlineSync.question(`How much ${dividendsType} would you like to distribute to token holders?: `);
          await checkBalance(dividend);
          let checkpointId = currentCheckpoint == 0 ? 0 : await selectCheckpoint(true); // If there are no checkpoints, it must create a new one
          await createDividends(divName, dividend, checkpointId);
        break;
        case 'Explore account at checkpoint':
          let _address =  readlineSync.question('Enter address to explore: ');
          let _checkpoint = await selectCheckpoint(false);
          await exploreAddress(_address, _checkpoint);
        break;
        case 'Explore total supply at checkpoint':
          let _checkpoint2 = await selectCheckpoint(false);
          await exploreTotalSupply(_checkpoint2);
        break;
        case 'Push dividends to accounts':
          let _dividend = await selectDividend({valid: true, expired: false, reclaimed: false, withRemaining: true});
          if (_dividend !== null) {
            let _addresses = readlineSync.question('Enter addresses to push dividends to (ex- add1,add2,add3,...): ');
            await pushDividends(_dividend, _addresses);
          }
        break;
        case `Explore ${dividendsType} balance`:
          let _address3 =  readlineSync.question('Enter address to explore: ');
          let _dividend3 = await selectDividend();
          if (_dividend3 !== null) {
            let dividendAmounts = await currentDividendsModule.methods.calculateDividend(_dividend3.index, _address3).call();
            let dividendBalance = dividendAmounts[0];
            let dividendTax = dividendAmounts[1];
            let balance = await getBalance(_address3);
            console.log(`
  ${dividendsType} Balance: ${web3.utils.fromWei(balance)} ${dividendsType}
  Dividends owned: ${web3.utils.fromWei(dividendBalance)} ${dividendsType}
  Tax withheld: ${web3.utils.fromWei(dividendTax)} ${dividendsType}
            `);
          }
        break;
        case 'Reclaim expired dividends':
          let _dividend4 = await selectDividend({expired: true, reclaimed: false});
          if (_dividend4 !== null) {
            await reclaimedDividend(_dividend4);
          }
          break;
        case 'Cancel':
          process.exit(0);
          break;
      }
    }
  }
  //Restart
  await start_explorer();
}

async function mintTokens(address, amount){
  if (await securityToken.methods.mintingFrozen().call()) {
    console.log(chalk.red("Minting is not possible - Minting has been permanently frozen by issuer"));
  } else {
    await whitelistAddress(address);

    try {
      let mintAction = securityToken.methods.mint(address,web3.utils.toWei(amount));
      let receipt = await common.sendTransaction(Issuer, mintAction, defaultGasPrice);
      let event = common.getEventFromLogs(securityToken._jsonInterface, receipt.logs, 'Transfer');
      console.log(`
  Minted ${web3.utils.fromWei(event.value)} tokens
  to account ${event.to}`
      );
    } catch (err) {
      console.log(err);
      console.log(chalk.red("There was an error processing the transfer transaction. \n The most probable cause for this error is one of the involved accounts not being in the whitelist or under a lockup period."));
    }
  }
}

async function transferTokens(address, amount){
  await whitelistAddress(address);

  try{
    let transferAction = securityToken.methods.transfer(address,web3.utils.toWei(amount));
    let receipt = await common.sendTransaction(Issuer, transferAction, defaultGasPrice, 0, 1.5);
    let event = common.getEventFromLogs(securityToken._jsonInterface, receipt.logs, 'Transfer');
    console.log(`
  Account ${event.from}
  transfered ${web3.utils.fromWei(event.value)} tokens
  to account ${event.to}`
    );
  } catch (err) {
    console.log(err);
    console.log(chalk.red("There was an error processing the transfer transaction. \n The most probable cause for this error is one of the involved accounts not being in the whitelist or under a lockup period."));
  }
}

async function exploreAddress(address, checkpoint){
  let balance = await securityToken.methods.balanceOf(address).call();
  balance = web3.utils.fromWei(balance);
  console.log(`Balance of ${address} is: ${balance} (Using balanceOf)`);

  let balanceAt = await securityToken.methods.balanceOfAt(address,checkpoint).call();
  balanceAt = web3.utils.fromWei(balanceAt);
  console.log(`Balance of ${address} is: ${balanceAt} (Using balanceOfAt - checkpoint ${checkpoint})`);
}

async function exploreTotalSupply(checkpoint){
  let totalSupply = await securityToken.methods.totalSupply().call();
  totalSupply = web3.utils.fromWei(totalSupply);
  console.log(`TotalSupply is: ${totalSupply} (Using totalSupply)`);

  let totalSupplyAt = await securityToken.methods.totalSupplyAt(checkpoint).call();
  totalSupplyAt = web3.utils.fromWei(totalSupplyAt);
  console.log(`TotalSupply is: ${totalSupplyAt} (Using totalSupplyAt - checkpoint ${checkpoint})`);
}

async function setDefaultExclusions() {
  await addDividendsModule();

  let excluded = await currentDividendsModule.methods.getDefaultExcluded().call();
  showExcluded(excluded);

  console.log(chalk.yellow(`Excluded addresses will be loaded from 'dividendsExclusions_data.csv'. Please check your data before continue.`));
  if (readlineSync.keyInYNStrict(`Do you want to continue?`)) {
    let excluded = getExcludedFromDataFile();
    let setDefaultExclusionsActions = currentDividendsModule.methods.setDefaultExcluded(excluded);
    let receipt = await common.sendTransaction(Issuer, setDefaultExclusionsActions, defaultGasPrice);
    let event = common.getEventFromLogs(currentDividendsModule._jsonInterface, receipt.logs, 'SetDefaultExcludedAddresses');
    console.log(chalk.green(`Exclusions were successfuly set.`));
    showExcluded(event._excluded);    
  }
}

async function taxHoldingMenu() {
  await addDividendsModule();

  let options = ['Set a % to withhold from dividends sent to an address', 'Withdraw withholding for dividend', 'Return to main menu'];
  let index = readlineSync.keyInSelect(options, 'What do you want to do?', {cancel: false});
  let selected = options[index];
  console.log("Selected:", selected);
  switch (selected) {
    case 'Set a % to withhold from dividends sent to an address':
      let address = readlineSync.question('Enter the address of the investor: ', {
        limit: function(input) {
          return web3.utils.isAddress(input);
        },
        limitMessage: "Must be a valid address",
      });
      let percentage = readlineSync.question('Enter the percentage of dividends to withhold (number between 0-100): ', {
        limit: function(input) {
          return (parseInt(input) >= 0 && parseInt(input) <= 100);
        },
        limitMessage: "Must be a value between 0 and 100",
      });
      let percentageWei = web3.utils.toWei((percentage / 100).toString());
      let setWithHoldingFixedAction = currentDividendsModule.methods.setWithholdingFixed([address], percentageWei);
      let receipt = await common.sendTransaction(Issuer, setWithHoldingFixedAction, defaultGasPrice); 
      console.log(chalk.green(`Successfully set tax withholding of ${percentage}% for ${address}.`));
      break;
    case 'Withdraw withholding for dividend':
      let _dividend = await selectDividend({withRemainingWithheld: true});
      if (_dividend !== null) {
        let withdrawWithholdingAction = currentDividendsModule.methods.withdrawWithholding(_dividend.index);
        let receipt = await common.sendTransaction(Issuer, withdrawWithholdingAction, defaultGasPrice);
        let eventName;
        if (dividendsType == 'POLY') {
          eventName = 'ERC20DividendWithholdingWithdrawn';
        } else if (dividendsType == 'ETH') {
          eventName = 'EtherDividendWithholdingWithdrawn';
        }
        let event = common.getEventFromLogs(currentDividendsModule._jsonInterface, receipt.logs, eventName);
        console.log(chalk.green(`Successfully withdrew ${web3.utils.fromWei(event._withheldAmount)} ${dividendsType} from dividend ${_dividend.index} tax withholding.`));
      }
      break;
    case 'Return to main menu':
      break;
  }
}

async function createDividends(name, dividend, checkpointId) {
  await addDividendsModule();

  let time = Math.floor(Date.now()/1000);
  let maturityTime = readlineSync.questionInt('Enter the dividend maturity time from which dividend can be paid (Unix Epoch time)\n(Now = ' + time + ' ): ', {defaultInput: time});
  let defaultTime = time + duration.minutes(10);
  let expiryTime = readlineSync.questionInt('Enter the dividend expiry time (Unix Epoch time)\n(10 minutes from now = ' + defaultTime + ' ): ', {defaultInput: defaultTime});
  
  let useDefaultExcluded = readlineSync.keyInYNStrict(`Do you want to use the default excluded addresses for this dividend? If not, data from 'dividendsExclusions_data.csv' will be used instead.`);

  let createDividendAction;
  if (dividendsType == 'POLY') {
    let approveAction = polyToken.methods.approve(currentDividendsModule._address, web3.utils.toWei(dividend));
    await common.sendTransaction(Issuer, approveAction, defaultGasPrice);
    if (checkpointId > 0) {
      if (useDefaultExcluded) {
        createDividendAction = currentDividendsModule.methods.createDividendWithCheckpoint(maturityTime, expiryTime, polyToken._address, web3.utils.toWei(dividend), checkpointId, web3.utils.toHex(name));
      } else {
        let excluded = getExcludedFromDataFile();
        createDividendAction = currentDividendsModule.methods.createDividendWithCheckpointAndExclusions(maturityTime, expiryTime, polyToken._address, web3.utils.toWei(dividend), checkpointId, excluded, web3.utils.toHex(name));
      }
    } else {
      if (useDefaultExcluded) {
        createDividendAction = currentDividendsModule.methods.createDividend(maturityTime, expiryTime, polyToken._address, web3.utils.toWei(dividend), web3.utils.toHex(name));
      } else {
        let excluded = getExcludedFromDataFile();
        createDividendAction = currentDividendsModule.methods.createDividendWithExclusions(maturityTime, expiryTime, polyToken._address, web3.utils.toWei(dividend), excluded, web3.utils.toHex(name));
      }
    }
    let receipt = await common.sendTransaction(Issuer, createDividendAction, defaultGasPrice);
    let event = common.getEventFromLogs(currentDividendsModule._jsonInterface, receipt.logs, 'ERC20DividendDeposited');
    console.log(chalk.green(`Dividend ${event._dividendIndex} deposited`));
  } else if (dividendsType == 'ETH') {
    if (checkpointId > 0) {
      if (useDefaultExcluded) {
        createDividendAction = currentDividendsModule.methods.createDividendWithCheckpoint(maturityTime, expiryTime, checkpointId, web3.utils.toHex(name));
      } else {
        let excluded = getExcludedFromDataFile();
        createDividendAction = currentDividendsModule.methods.createDividendWithCheckpointAndExclusions(maturityTime, expiryTime, checkpointId, excluded, web3.utils.toHex(name));
      }
    } else {
      if (useDefaultExcluded) {
        createDividendAction = currentDividendsModule.methods.createDividend(maturityTime, expiryTime, web3.utils.toHex(name));
      } else {
        let excluded = getExcludedFromDataFile();
        createDividendAction = currentDividendsModule.methods.createDividendWithExclusions(maturityTime, expiryTime, excluded, web3.utils.toHex(name));
      }
    }
    let receipt = await common.sendTransaction(Issuer, createDividendAction, defaultGasPrice, web3.utils.toWei(dividend));
    let event = common.getEventFromLogs(currentDividendsModule._jsonInterface, receipt.logs, 'EtherDividendDeposited');
    console.log(`
  Dividend ${event._dividendIndex} deposited`
    );
  }
}

async function pushDividends(dividend, account){
  let accs = account.split(',');
  let pushDividendPaymentToAddressesAction = currentDividendsModule.methods.pushDividendPaymentToAddresses(dividend.index, accs);
  let receipt = await common.sendTransaction(Issuer, pushDividendPaymentToAddressesAction, defaultGasPrice);
  let successEventName;
  if (dividendsType == 'POLY') {
    successEventName = 'ERC20DividendClaimed';
  } else if (dividendsType == 'ETH') {
    successEventName = 'EtherDividendClaimed';
    let failedEventName = 'EtherDividendClaimFailed';
    let failedEvents = common.getMultipleEventsFromLogs(currentDividendsModule._jsonInterface, receipt.logs, failedEventName);
    for (const event of failedEvents) {
      console.log(`
  Failed to claim ${web3.utils.fromWei(event._amount)} ${dividendsType}
  to account ${event._payee}`
      );
    }
  }

  let successEvents = common.getMultipleEventsFromLogs(currentDividendsModule._jsonInterface, receipt.logs, successEventName);
  for (const event of successEvents) {
    console.log(`
  Claimed ${web3.utils.fromWei(event._amount)} ${dividendsType}
  to account ${event._payee}
  ${web3.utils.fromWei(event._withheld)} ${dividendsType} of tax withheld`
    );
  }
}

async function reclaimedDividend(dividend) {
  let reclaimDividendAction = currentDividendsModule.methods.reclaimDividend(dividend.index);
  let receipt = await common.sendTransaction(Issuer, reclaimDividendAction, defaultGasPrice);
  let eventName;
  if (dividendsType == 'POLY') {
    eventName = 'ERC20DividendReclaimed';
  } else if (dividendsType == 'ETH') {
    eventName = 'EtherDividendReclaimed';
  }
  let event = common.getEventFromLogs(currentDividendsModule._jsonInterface, receipt.logs, eventName);
  console.log(`
  Reclaimed Amount ${web3.utils.fromWei(event._claimedAmount)} ${dividendsType}
  to account ${event._claimer}`
  );
}

async function whitelistAddress(address) {
  let now = Math.floor(Date.now() / 1000);
  let modifyWhitelistAction = generalTransferManager.methods.modifyWhitelist(address, now, now, now + 31536000, true);
  await common.sendTransaction(Issuer, modifyWhitelistAction, defaultGasPrice);
  console.log(chalk.green(`\nWhitelisting successful for ${address}.`));
}

// Helper functions
async function getBalance(address) {
  let balance;
  if (dividendsType == 'POLY') {
    balance = (await polyToken.methods.balanceOf(address).call()).toString();
  } else if (dividendsType == 'ETH') {
    balance = (await web3.eth.getBalance(address)).toString();
  }

  return balance;
}
async function checkBalance(_dividend) {
  let issuerBalance = await getBalance(Issuer.address);
  if (parseInt(web3.utils.fromWei(issuerBalance)) < parseInt(_dividend)) {
    console.log(chalk.red(`
  You have ${web3.utils.fromWei(issuerBalance)} ${dividendsType} need ${(parseInt(_dividend) - parseInt(web3.utils.fromWei(issuerBalance)))} more ${dividendsType}
  `));
    process.exit(0);
  }
}

async function isDividendsModuleAttached() {
  let dividendsModuleName;
  if (dividendsType == 'POLY') {
    dividendsModuleName = 'ERC20DividendCheckpoint';
  } else if (dividendsType == 'ETH') {
    dividendsModuleName = 'EtherDividendCheckpoint';
  }

  let result = await securityToken.methods.getModulesByName(web3.utils.toHex(dividendsModuleName)).call();
  if (result.length > 0) {
    let dividendsModuleAddress = result[0];
    let dividendsModuleABI;
    if (dividendsType == 'POLY') {
      dividendsModuleABI = abis.erc20DividendCheckpoint();
    } else if (dividendsType == 'ETH') {
      dividendsModuleABI = abis.etherDividendCheckpoint();
    }
    currentDividendsModule = new web3.eth.Contract(dividendsModuleABI, dividendsModuleAddress);
    currentDividendsModule.setProvider(web3.currentProvider);
  }

  return (typeof currentDividendsModule !== 'undefined');
}

async function addDividendsModule() {
  if (!(await isDividendsModuleAttached())) {
    let dividendsFactoryName;
    let dividendsModuleABI;
    if (dividendsType == 'POLY') {
      dividendsFactoryName = 'ERC20DividendCheckpoint';
      dividendsModuleABI = abis.erc20DividendCheckpoint();
    } else if (dividendsType == 'ETH') {
      dividendsFactoryName = 'EtherDividendCheckpoint';
      dividendsModuleABI = abis.etherDividendCheckpoint();
    }

    let dividendsFactoryAddress = await contracts.getModuleFactoryAddressByName(securityToken.options.address, MODULES_TYPES.DIVIDENDS, dividendsFactoryName);
    let addModuleAction = securityToken.methods.addModule(dividendsFactoryAddress, web3.utils.fromAscii('', 16), 0, 0);
    let receipt = await common.sendTransaction(Issuer, addModuleAction, defaultGasPrice);
    let event = common.getEventFromLogs(securityToken._jsonInterface, receipt.logs, 'ModuleAdded');
    console.log(`Module deployed at address: ${event._module}`);
    currentDividendsModule = new web3.eth.Contract(dividendsModuleABI, event._module);
    currentDividendsModule.setProvider(web3.currentProvider);
  }
}

async function selectCheckpoint(includeCreate) {
  let options = [];
  let fix = 1; //Checkpoint 0 is not included, so I need to add 1 to fit indexes for checkpoints and options
  let checkpoints = (await getCheckpoints()).map(function(c) { return c.timestamp });
  if (includeCreate) {
    options.push('Create new checkpoint');
    fix = 0; //If this option is added, fix isn't needed.
  }
  options = options.concat(checkpoints);

  return readlineSync.keyInSelect(options, 'Select a checkpoint:', {cancel: false}) + fix;
}

async function getCheckpoints() {
  let result = [];
  
  let checkPointsTimestamps = await securityToken.methods.getCheckpointTimes().call();
  for (let index = 0; index < checkPointsTimestamps.length; index++) {
    let checkpoint = {};
    checkpoint.id = index + 1;
    checkpoint.timestamp = moment.unix(checkPointsTimestamps[index]).format('MMMM Do YYYY, HH:mm:ss');
    result.push(checkpoint);
  }

  return result.sort((a, b) => a.id - b.id);
}

async function selectDividend(filter) {
  let result = null;
  let dividends = await getDividends();

  let now = Math.floor(Date.now()/1000);
  if (typeof filter !== 'undefined') {
    if (typeof filter.valid !== 'undefined') {
      dividends = dividends.filter(d => filter.valid == (now > d.maturity));
    }
    if (typeof filter.expired !== 'undefined') {
      dividends = dividends.filter(d => filter.expired == (d.expiry < now));
    }
    if (typeof filter.reclaimed !== 'undefined') {
      dividends = dividends.filter(d => filter.reclaimed == d.reclaimed);
    }
    if (typeof filter.withRemainingWithheld !== 'undefined') {
      dividends = dividends.filter(d => new web3.utils.BN(d.dividendWithheld).sub(new web3.utils.BN(d.dividendWithheldReclaimed)) > 0);
    }
    if (typeof filter.withRemaining !== 'undefined') {
      dividends = dividends.filter(d => new web3.utils.BN(d.amount).sub(new web3.utils.BN(d.claimedAmount)) > 0);
    }
  }

  if (dividends.length > 0) {
    let options = dividends.map(function(d) {
      return `${web3.utils.toAscii(d.name)}
    Created: ${moment.unix(d.created).format('MMMM Do YYYY, HH:mm:ss')}
    Maturity: ${moment.unix(d.maturity).format('MMMM Do YYYY, HH:mm:ss')}
    Expiry: ${moment.unix(d.expiry).format('MMMM Do YYYY, HH:mm:ss')}
    At checkpoint: ${d.checkpointId}
    Amount: ${web3.utils.fromWei(d.amount)} ${dividendsType}
    Claimed Amount: ${web3.utils.fromWei(d.claimedAmount)} ${dividendsType}
    Withheld: ${web3.utils.fromWei(d.dividendWithheld)} ${dividendsType}
    Withheld claimed: ${web3.utils.fromWei(d.dividendWithheldReclaimed)} ${dividendsType}`
    });

    let index = readlineSync.keyInSelect(options, 'Select a dividend:');
    if (index != -1) {
      result = dividends[index];
    }
  } else {
    console.log(chalk.red(`No dividends were found meeting the requirements`))
    console.log(chalk.red(`Requirements: Valid: ${filter.valid} - Expired: ${filter.expired} - Reclaimed: ${filter.reclaimed}
    WithRemainingWithheld: ${filter.withRemainingWithheld} - WithRemaining: ${filter.withRemaining}\n`))
  }

  return result;
}

async function getDividends() {
  let result = [];

  let currentCheckpoint = await securityToken.methods.currentCheckpointId().call();
  for (let index = 1; index <= currentCheckpoint; index++) {
    let dividendIndexes = await currentDividendsModule.methods.getDividendIndex(index).call();
    for (const i of dividendIndexes) {
      let dividend = await currentDividendsModule.methods.dividends(i).call();
      dividend.index = i;
      result.push(dividend);
    }
  }

  return result;
}

function getExcludedFromDataFile() {
  let excludedFromFile = require('fs').readFileSync('./CLI/data/dividendsExclusions_data.csv').toString().split("\n");
  let excluded = excludedFromFile.filter(function (address) {
    return web3.utils.isAddress(address);
  });
  return excluded;
}

function showExcluded(excluded) {
  if (excluded.length > 0) {
    console.log('Current default excluded addresses:')
    excluded.map(function (address) { console.log(' ', address) });
  } else {
    console.log('There are not default excluded addresses.')
  }
  console.log();
}

module.exports = {
  executeApp: async function(type, remoteNetwork) {
    return executeApp(type, remoteNetwork);
  }
}
