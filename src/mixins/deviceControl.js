const W3CWebSocket = require('websocket').w3cwebsocket;
const WebSocketAsPromised = require('websocket-as-promised');
const delay = require('delay');

const { nonce } = require('../helpers/utilities');
const errors = require('../data/errors');

const timestamp = () => Math.floor(new Date() / 1000);
const sequence = () => Math.floor(new Date())

const {
  VALID_POWER_STATES,
  getNewPowerState,
  getPowerStateParams,
  getAllChannelsState,
  getSpecificChannelState,
} = require('../helpers/device-control');

module.exports = {
  async initDeviceControl(params = {}) {
    // check if socket is already initialized
    if (this.wsp) {
      return;
    } else {
      throw new Error('no websocket open');
    }
  },
  
  /**
   * WebSocket authentication process
   */
  async webSocketHandshake() {
    const apikey = this.deviceApiKey || this.apiKey;

    const payload = JSON.stringify({
      action: 'userOnline',
      version: 8,
      ts: timestamp(),
      at: this.at,
      userAgent: 'app',
      apikey,
      appid: this.APP_ID,
      nonce,
      sequence: sequence()
    });

    await this.wsp.send(payload);
    await delay(this.wsDelayTime);
  },

  /**
   * Close WebSocket connection and class cleanup
   */
  async webSocketClose() {
    await this.wsp.close();
    delete this.wsDelayTime;
    delete this.wsp;
    delete this.deviceApiKey;
  },

  /**
   * Update device status (timers, share status, on/off etc)
   */
  async updateDeviceStatus(deviceId, params, seq = null) {
    await this.initDeviceControl();

    const apikey = this.deviceApiKey || this.apiKey;

    if ( !seq ) {
      seq = sequence()
    }

    const payload = JSON.stringify({
      action: 'update',
      deviceid: deviceId,
      apikey,
      userAgent: 'app',
      sequence: seq,
      ts: timestamp(),
      params,
    });

    await this.wsp.send(payload);
    return payload
  },

  /**
   * Check device status (timers, share status, on/off etc)
   */
  async getWSDeviceStatus(deviceId, params) {
    await this.initDeviceControl();

    let response = null;

    /*
    this.wsp.onMessage.addListener(message => {
      const data = JSON.parse(message);
      if (data.deviceid === deviceId) {
        response = data;
      }
    });
    */

    const apikey = this.deviceApiKey || this.apiKey;

    const payload = JSON.stringify({
      action: 'query',
      deviceid: deviceId,
      apikey,
      userAgent: 'app',
      sequence: sequence(),
      ts: timestamp(),
      params,
    });

    this.wsp.send(payload);
    //await delay(this.wsDelayTime);

    /*
    // throw error on invalid device
    if (response.error) {
      throw new Error(errors[response.error]);
    }

    return response;
    */
  },

  /**
   * Get device power state
   */
  async getWSDevicePowerState(deviceId, options = {}) {
    // get extra parameters
    const { channel = 1, allChannels = false, shared = false } = options;

    // if device is shared by other account, fetch device api key
    if (shared) {
      const device = await this.getDevice(deviceId);
      this.deviceApiKey = device.apikey;
    }

    // get device current state
    const status = await this.getWSDeviceStatus(deviceId, [
      'switch',
      'switches',
    ]);

    // close websocket connection
    //await this.webSocketClose();

    // check for multi-channel device
    const multiChannelDevice = !!status.params.switches;

    // returns all channels
    if (multiChannelDevice && allChannels) {
      return {
        status: 'ok',
        state: getAllChannelsState(status.params),
      };
    }

    // multi-channel device & requested channel
    if (multiChannelDevice) {
      return {
        status: 'ok',
        state: getSpecificChannelState(status.params, channel),
        channel,
      };
    }

    // single channel device
    return {
      status: 'ok',
      state: status.params.switch,
      channel,
    };
  },

  /**
   * Set device power state
   */
  setWSDevicePowerState(deviceId, state, options = {}) {
    // check for valid power state
    if (!VALID_POWER_STATES.includes(state)) {
      throw new Error(errors.invalidPowerState);
    }

    // get extra parameters
    const { channel = 1, shared = false } = options;

 
    const that = this
    return new Promise((resolve, reject) => {
      that.getDevice(deviceId).then(device => {
        if (shared) {
          that.deviceApiKey = device.apikey;
        }

        const params = getPowerStateParams(device.params, state, channel);
        
        let timeout
        const seq = sequence()
        const listener = message => {
          let data
          try {
            data = JSON.parse(message);
          } catch (err) {
            return
          }
          if (data.deviceid === deviceId && data.sequence == seq) {
            if ( timeout ) {
              clearTimeout(timeout)
            }
            that.wsp.onMessage.removeListener(listener)
            resolve({ status: data.error === 0 ? 'ok' : 'error', message: data.reason});
          }
        }
        
        that.wsp.onMessage.addListener(listener);
        
        timeout = setTimeout(() => {
          timeout = undefined
          that.wsp.onMessage.removeListener(listener)
          resolve({ status: 'error', message: 'timed out waiting for response'})
        }, 5000)
        
        that.updateDeviceStatus(deviceId, params, seq).catch(reject)
      })
        .catch(reject)
    })
  },

  setWSDeviceParams(deviceId, params, options = {}) {
    // get extra parameters
    const { channel = 1, shared = false } = options;

    const that = this
    return new Promise((resolve, reject) => {
      that.getDevice(deviceId).then(device => {
        if (shared) {
          that.deviceApiKey = device.apikey;
        }
        
        let timeout
        const seq = sequence()

        const listener = message => {
          let data
          try {
            data = JSON.parse(message);
          } catch (err) {
            return
          }
          
          if (data.deviceid === deviceId && data.sequence == seq) {
            if ( timeout ) {
              clearTimeout(timeout)
            }
            that.wsp.onMessage.removeListener(listener)
            resolve({ status: data.error === 0 ? 'ok' : 'error', message: data.reason});
          }
        }
        
        that.wsp.onMessage.addListener(listener);
        
        timeout = setTimeout(() => {
          timeout = undefined
          that.ws.onMessage.removeListener(listener)
          reject({ status: 'error', message: 'timed out waiting for response'})
        }, 5000)
        
        that.updateDeviceStatus(deviceId, params, seq).catch(reject)
      })
        .catch(reject)
    })
  },
  

  /*
  async setWSDeviceParams(deviceId, params, options = {}) {
    // check for valid power state

    // get extra parameters
    const { shared = false } = options;

    // if device is shared by other account, fetch device api key
    if (shared) {
      const device = await this.getDevice(deviceId);
      this.deviceApiKey = device.apikey;
    }

    // change device status
    try {
      await this.updateDeviceStatus(deviceId, params);
      //await delay(this.wsDelayTime);
    } catch (error) {
      throw new Error(error);
    } finally {
      //await this.webSocketClose();
    }

    return {
      status: 'ok'
    };
  },
  */
  
  
};
