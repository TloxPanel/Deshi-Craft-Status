const config = require('./config.json');

// Convert string color values to integers
const processedConfig = {
    ...config,
    colors: {
        primary: parseInt(config.colors.primary),
        success: parseInt(config.colors.success),
        error: parseInt(config.colors.error),
        warning: parseInt(config.colors.warning),
        background: parseInt(config.colors.background)
    }
};

module.exports = processedConfig;
