/*
---

name: ValidateSimple
script: ValidateSimple.js
description: Simple form validation with good UX

requires:
  - Core/Class.Extras
  - Core/Element.Event
  - More/Events.Pseudos
  - More/Element.Event.Pseudos
  - More/Class.Binds

provides: [ValidateSimple]

authors:
  - Ian Collins

...
*/

var ValidateSimple = new Class({

  Implements: [Events, Options],

  Binds: ['checkValid', 'onSubmit'],

  options: {
    active: true,
    validateOnSubmit: true,
    initialValidation: true,
    alertPrefilled: true,
    alertUnedited: true,
    inputSelector: 'input',
    invalidClass: 'invalid',
    validClass: 'valid',
    optionalClass: 'optional',
    attributeForType: 'class',
    alertEvent: 'blur',
    correctionEvent: 'keyup:filterInvalidKeys',
    validateEvent: 'keyup:filterInvalidKeys',
    checkPeriodical: 500,
    noValidateKeys: ['left','right','up','down','esc','tab','command','option','control']
  },

  state: 'untouched',

  initialize: function(element, options){
    this.setOptions(options);

    this.element = document.id(element).addClass('untouched');
    this.parentForm = this.element.get('tag') == 'form' ? this.element : this.element.getParent('form');
    this.inputs  = this.options.inputs || this.element.getElements(this.options.inputSelector);

    this.element.store('validate-simple-instance', this);

    this.inputs = this.inputs.filter(function(input){
      return !input.hasClass(this.options.optionalClass) && !input.get('disabled');
    }, this);

    Event.definePseudo('filterInvalidKeys', function(split, fn, args){
      if (!this.options.noValidateKeys.contains(args[0].key))
        fn.apply(this, args);
    }.bind(this));

    if (this.options.active) this.activate();
    if (this.options.initialValidation) this.validateAllInputs();

    return this;
  },

  attach: function(){
    if (!this.active){
      this.active = true;

      $(document.body).addEvent('keydown:relay(' + this.options.inputSelector + ')', function(e){
        if (e.key !== 'tab' && this.options.noValidateKeys.contains(e.key)){
          this.active = false;
          (function(){ this.active = true; }).delay(1000, this);
        }
      }.bind(this));
      $(document.body).addEvent('keyup:relay(' + this.options.inputSelector + ')', function(e){
        if (e.key !== 'tab' && this.options.noValidateKeys.contains(e.key))
          (function(){ this.active = true; }).delay(100, this);
      }.bind(this));

      this.inputs.each(function(input){
        input.addFocusedProperty();

        var validateEvent = input.get('type').test(/select|radio|checkbox/) ? 'change' : this.options.validateEvent;
        input.addEvent(validateEvent, function(e){
          if (e.key !== 'tab') this.inputTouched(input);
        }.bind(this));

        var callbacks = [this.validateInput.pass(input, this), this.alertInputValidity.pass(input, this)];
        input.addEvent(validateEvent, callbacks[0]);
        input.addEvent('change', callbacks[0]);
        input.addEvent(this.options.alertEvent, callbacks[1]);

        var prevValue = this.getInputValue(input);
        input.store('vs-previous-value', prevValue);
        if (this.options.alertPrefilled && prevValue){
          this.inputTouched(input);
          this.validateInput(input);
          this.alertInputValidity(input);
        }

        input.store('validate-simple-callbacks', callbacks);
        input.store('validate-simple-instance', this);
      }, this);

      if (this.options.validateOnSubmit)
        this.parentForm.addEvent('submit', this.onSubmit);

      if (this.options.checkPeriodical)
        this.checkForChangedInputsPeriodical = this.checkForChangedInputs.periodical(this.options.checkPeriodical, this);
    }

    return this;
  },
  detach: function(){
    this.active = false;
    this.inputs.each(function(input){
      var callbacks = input.retrieve('validate-simple-callbacks');
      if (callbacks){
        input.removeEvent(this.options.validateEvent, callbacks[0]);
        input.removeEvent('change', callbacks[0]);
        input.removeEvent(this.options.alertEvent, callbacks[1]);
        if (callbacks[2])
          input.removeEvent(this.options.correctionEvent, callbacks[2]);
      }
      input.store('validate-simple-watching', false);
    }, this);

    if (this.options.validateOnSubmit)
      this.parentForm.removeEvent('submit', this.onSubmit);

    clearInterval(this.checkForChangedInputsPeriodical);
    return this;
  },

  onSubmit: function(e){
    if (!this.validateAllInputs()){
      if (e) e.preventDefault();
      this.fireEvent('invalidSubmit', [this, e]);
      this.alertAllInputs();
    } else
      this.fireEvent('validSubmit', [this, e]);
  },

  activate: function(){ this.attach(); },
  deactivate: function(){ this.detach(); },

  inputTouched: function(input){
    if (!input.retrieve('validate-simple-touched')){
      input.store('validate-simple-touched', true);
      this.fireEvent('inputTouched', [input, this]);
    }
    if (this.element.hasClass('untouched'))
      this.changeState('touched');
  },

  _getValidatorTypesForInput: function(input){
    var validatorTypes = input.get(this.options.attributeForType);
    if (this.options.attributeForType == 'class'){
      var mtch = validatorTypes.match(/validate\-[\w-]+/g);
      validatorTypes = (mtch && mtch.length > 0) ? mtch : ['text'];
    }
    var v = validatorTypes.map(function(vt){ return vt.replace('validate-',''); });
    return v;
  },
  _validatorWasValid: function(input, validatorType, testResult){
    var validator = ValidateSimple.Validators[validatorType];
    this.removeErrorFromInput(input, validatorType);
    if (validator.postMatch)
      validator.postMatch(testResult, input);
  },
  _validatorWasInvalid: function(input, validatorType, shouldAlert){
    this.invalidateInput(input, validatorType);
    if (shouldAlert) this.alertInputValidity(input);
  },

  validateInput: function(input){
    if (!this.active || input == undefined || input.retrieve('validate-simple-locked'))
      return this;
    else if (input.get('tag') == 'option')
      return this.validateInput(input.getParent());

    input.store('validate-simple-is-valid', true);

    this._getValidatorTypesForInput(input).each(function(validatorType){
      var validator = ValidateSimple.Validators[validatorType],
          handleValidatorResult = function(testResult){
            testResult ? this._validatorWasValid(input, validatorType, testResult)
                       : this._validatorWasInvalid(input, validatorType, validator.async);
          }.bind(this);

      if (validator.async){
        (function(){
          if (input.retrieve('validate-simple-is-valid'))
            validator.test(input, handleValidatorResult);
        }).afterNoCallsIn(validator.wait || 10);
      } else {
        var testResult = validator.test(input);
        handleValidatorResult(testResult);
      }
    }, this);

    if (input.retrieve('validate-simple-is-valid')){
      input.store('validate-simple-errors', null);
      this.alertInputValidity(input);
    }

    this.checkValid();
    return this;
  },
  validateAllInputs: function(){
    this.inputs.each(function(input){
      this.validateInput(input);
    }, this);
    return this.state == 'valid';
  },

  addErrorToInput: function(input, error){
    var errors = input.retrieve('validate-simple-errors') || [];
    input.store('validate-simple-errors', errors.include(error));
  },
  removeErrorFromInput: function(input, error){
    var errors = input.retrieve('validate-simple-errors');
    if (errors && errors.length > 0)
      input.store('validate-simple-errors', errors.erase(error));
  },

  invalidateInput: function(input, validatorType){
    if (input.retrieve('validate-simple-locked')) return this;
    input.store('validate-simple-is-valid', false);
    this.addErrorToInput(input, validatorType);
    this.changeState('invalid');
    return this;
  },
  lockInput: function(input){
    input.store('validate-simple-locked', true);
    return this;
  },
  unlockInput: function(input){
    input.store('validate-simple-locked', false);
    return this;
  },

  alertInputValidity: function(input){
    if (!this.active || input == undefined) return this;

    var inputValid = input.retrieve('validate-simple-is-valid'),
        isEdited = this.options.alertUnedited ? true : input.retrieve('validate-simple-touched');

    if (this.state != 'untouched' && isEdited){
      if (inputValid){
        input.addClass(this.options.validClass).removeClass(this.options.invalidClass);
        this.fireEvent('inputValid', [input, this]);
      } else {
        input.addClass(this.options.invalidClass).removeClass(this.options.validClass);
        this.fireEvent('inputInvalid', [input, input.retrieve('validate-simple-errors'), this]);
      }

      if (!input.retrieve('validate-simple-watching')){
        var callback = this.alertInputValidity.pass(input, this);
        input.addEvent(this.options.correctionEvent, callback);
        input.store('validate-simple-watching', true);
        var callbacks = input.retrieve('validate-simple-callbacks') || [];
        input.store('validate-simple-callbacks', callbacks.include(callback));
      }
    }
    return this;
  },
  alertAllInputs: function(){
    this.options.alertUnedited = true;
    this.inputs.each(function(input){
      this.alertInputValidity(input);
    }, this);
    return this;
  },

  getInputValue: function(input){
    return input.get('type').test(/radio|checkbox/) ? input.get('checked') : input.get('value');
  },

  checkForChangedInputs: function(){
    this.inputs.each(function(input){
      var previous = input.retrieve('vs-previous-value'),
          current = this.getInputValue(input);

      if (previous != current){
        this.inputTouched(input);
        this.validateInput(input);
        if (!input.retrieve('focused')) this.alertInputValidity(input);
      }
      input.store('vs-previous-value', current);
    }, this);
    return this;
  },

  checkValid: function(){
    var allInputsValidOrOptional = this.inputs.every(function(input){
      return input.retrieve('validate-simple-is-valid') || input.hasClass(this.options.optionalClass);
    }, this);

    this.changeState(allInputsValidOrOptional ? 'valid' : 'invalid');
    return this;
  },

  changeState: function(state){
    this.state = state;
    this.element.addClass(state);
    if (state == 'valid') this.element.removeClass('invalid');
    else if (state == 'invalid') this.element.removeClass('valid');
    else if (state == 'touched') this.element.removeClass('untouched');
    this.fireEvent(state, this);
    return this;
  }

});


ValidateSimple.Validators = {
  'email': {
    test: function(input){
      return input.get('value').test(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i);
    }
  },
  'text': {
    test: function(input){
      return ((input.get('value') != null) && (input.get('value').length > 0));
    }
  },
  'checked': {
    test: function(input){
      return input.checked;
    }
  },
  'name': {
    test: function(input){
      return input.get('value').test(/^[A-Za-z -'&]+$/);
    }
  },
  'url': {
    test: function(input){
      return input.get('value').test(/^(https?|ftp|rmtp|mms):\/\/(([A-Z0-9][A-Z0-9_-]*)(\.[A-Z0-9][A-Z0-9_-]*)+)(:(\d+))?\/?/i);
    }
  },
  'alpha': {
    test: function(input){
      return input.get('value').test(/^[a-zA-Z]+$/);
    }
  },
  'alphanumeric': {
    test: function(input){
      var value = input.get('value');
      return value.length > 0 && !value.test(/\W/);
    }
  },
  'numeric': {
    test: function(input){
      return input.get('value').test(/^-?(?:0$0(?=\d*\.)|[1-9]|0)\d*(\.\d+)?$/);
    }
  },
  'zipcode': {
    test: function(input){
      return input.get('value').test(/^\d{5}(-?\d{4})?$/);
    }
  },
  'state': {
    test: function(input){
      var states = ['AL','AK','AS','AZ','AR','AE','AA','AE','AP','CA','CO','CT','DE','DC','FM','FL','GA','GU','HI','ID','IL','IN','IA','KS','KY','LA','ME','MH','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','MP','OH','OK','OR','PW','PA','PR','RI','SC','SD','TN','TX','UT','VT','VI','VA','WA','WV','WI','WY'],
          value = input.get('value').clean().toUpperCase();
      if (states.contains(value))
        return value;
    }
  }
};

Event.Keys['command'] = 91;
Event.Keys['option'] = 18;
Event.Keys['shift'] = 16;
Event.Keys['control'] = 17;

Element.implement({
	addFocusedProperty: function(){
		this.store('focused', false);
		this.addEvent('focus', (function(){ this.store('focused', true);  }).bind(this));
		this.addEvent('blur',  (function(){ this.store.delay(500, this, ['focused', false]); }));
	}
});

Function.implement({
  afterNoCallsIn: function(time, bind, args){
    clearTimeout(this._afterNoCallsInDelayId);
    this._afterNoCallsInDelayId = this.delay(time, bind, args);
  }
});
