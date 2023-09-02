const UNIT = 0;
const SECTION = 1;

const toggleClassName = "toggle no-print";
const toggleTooltip = "Mark as private\nPrivate elements can be toggled with the button at the top\
 to print public versions of the list"

var globals = {
	dragType: UNIT,
	draggedElement: null
}

function toggleClass(element, className) {
	if (element.classList.contains(className)) {
		element.classList.remove(className);
	} else {
		element.classList.add(className);
	}
}

function createDiv(className = "") {
	let div = document.createElement("div");
	div.className = className;

	return div;
}

function createElementWithText(element, text, className = "") {
	let root = document.createElement(element);
	root.className = className;

	let textNode = document.createTextNode(text);
	root.appendChild(textNode);

	return root;
}

function createRow() {
	return document.createElement("tr");
}

function createHeaderCell(text) {
	let cell = document.createElement("th");

	if (text !== undefined) {
		let textNode = document.createTextNode(text);
		cell.appendChild(textNode);
	}

	return cell;
}

function createCell(text) {
	let cell = document.createElement("td");

	if (text !== undefined) {
		let textNode = document.createTextNode(text);
		cell.appendChild(textNode);
	}

	return cell;
}

function createCheckbox() {
	let input = document.createElement("input");
	input.type = "checkbox";
	input.title = toggleTooltip;
	input.className = toggleClassName;

	return input;
}

function createSectionHeader(text, collapsed = false) {
	let headerNode = createDiv("section-header");

	let dragIconNode = createElementWithText("span", "⇕", "no-print draggable");
	headerNode.appendChild(dragIconNode);

	let arrowNode = createElementWithText("span", (collapsed) ? "▷" : "▽", "arrow no-print");
	headerNode.appendChild(arrowNode);

	let toggleNode = createCheckbox();
	headerNode.appendChild(toggleNode);

	let textNode = document.createTextNode(text);
	headerNode.appendChild(textNode);

	return headerNode;
}

function handleFile() {
	const rosterInput = document.getElementById("rosterInput");

	if (rosterInput.files.length < 1) {
		return;
	}

	function loadRoster(fileContent) {
		let previousRoster = document.getElementById("roster");
		if (previousRoster) {
			let togglePrivateElementsCheckbox = document.getElementById("togglePrivateCheckbox");
			togglePrivateElementsCheckbox.checked = false;
			previousRoster.remove();
		}

		let roster = loadRosterFromText(fileContent);
		let newRosterNode = createRosterView(roster);
		document.body.appendChild(newRosterNode);

		addInputCallbacks(newRosterNode);
	}

	if (rosterInput.files[0].name.endsWith("z")) {
		JSZip.loadAsync(rosterInput.files[0]).then(zip => {
			const firstFile = zip.files[Object.keys(zip.files)[0]];
			firstFile.async("string").then(fileContent => {
				loadRoster(fileContent)
			});
		});
	} else {
		rosterInput.files[0].text().then(fileContent => {
			loadRoster(fileContent);
		});
	}
}

function loadRosterFromText(rosterText) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(rosterText, "application/xml");
	const errorNode = doc.querySelector("parsererror");
	if (errorNode) {
		alert("Error parsing roster");
		return;
	}

	const rosterRoot = doc.firstChild;

	let roster = {};
	roster.name = rosterRoot.getAttribute("name");
	roster.points = parseFloat(rosterRoot
		.querySelector(":scope > costs > cost[name=\"pts\"]")
		.getAttribute("value"));
	roster.maxPoints = 0;

	const costLimit = rosterRoot.querySelector(":scope > costLimits > costLimit[name=\"pts\"]");
	if (costLimit) {
		roster.maxPoints = parseFloat(costLimit.getAttribute("value"));
	}

	const force = rosterRoot.querySelector(":scope > forces > force");
	roster.armyName = force.getAttribute("catalogueName");

	const units = force.querySelectorAll(":scope > selections > selection");
	roster.units = []
	units.forEach(unit => {
		let parsedUnit = parseUnit(unit);
		if (parsedUnit) {
			roster.units.push(parsedUnit);
		}
	});

	roster.ruleDescriptions = {};
	const rules = rosterRoot.querySelectorAll(":scope rule");
	rules.forEach(rule => {
		const ruleDescription = rule.querySelector(":scope > description");
		if (ruleDescription) {
			roster.ruleDescriptions[rule.getAttribute("name")] = ruleDescription.textContent;
		}
	});

	return roster;
}

function parseUnit(unitRoot) {
	let unit = {}

	unit.name = unitRoot.getAttribute("name");
	unit.cost = 0.0;
	unit.category = "";
	unit.profiles = [];
	unit.weapons = [];
	unit.armours = [];
	unit.extraProfiles = {};
	unit.rules = parseRules(unitRoot);
	unit.spells = {};
	unit.upgrades = [];
	unit.selections = {};
	unit.nestedUnit = {};

	const categoryNode = unitRoot.querySelector(":scope > categories > category[primary=\"true\"]");
	if (!categoryNode) {
		return null;
	}
	unit.category = categoryNode.getAttribute("name");

	const costs = unitRoot.querySelectorAll(":scope costs > cost");
	costs.forEach(costRoot => {
		unit.cost += parseFloat(costRoot.getAttribute("value"));
	});

	const profiles = unitRoot.querySelectorAll(":scope profiles profile");
	profiles.forEach(profileRoot => {
		const type = profileRoot.getAttribute("typeName");
		if (type === "Model") {
			unit.profiles.push(parseModelProfile(profileRoot));
		} else if (type === "Weapon") {
			unit.weapons.push(parseWeaponProfile(profileRoot));
		} else if (type == "Armour") {
			unit.armours.push(parseArmourProfile(profileRoot));
		} else if (type !== "Spell" && type !== "Wizard") {
			const profile = parseGenericProfile(profileRoot);
			if (unit.extraProfiles[profile.typeName] === undefined) {
				unit.extraProfiles[profile.typeName] = [];
			}
			unit.extraProfiles[profile.typeName].push(profile);
		}
	});

	const spells = unitRoot.querySelectorAll(":scope profiles profile[typeName=\"Spell\"]")
	spells.forEach(spellRoot => {
		let spell = parseSpell(spellRoot);

		if (unit.spells[spell.lore] === undefined) {
			unit.spells[spell.lore] = [];
		}
		unit.spells[spell.lore].push({
			name: spell.name,
			level: spell.level,
			type: spell.type,
			castingValue: spell.castingValue,
			range: spell.range,
			description: spell.details
		});
	})

	unit.upgrades = parseUpgrades(unitRoot);

	flattenRulesAndSelections(unit);

	return unit;
}

function parseModelProfile(profileRoot) {
	const characteristics = profileRoot.querySelector(":scope > characteristics");

	let profile = {};
	profile.name = profileRoot.getAttribute("name");
	profile.count = profileRoot.parentElement.parentElement.getAttribute("number");
	const movement = characteristics.querySelector(":scope > characteristic[name=\"M\"]").firstChild;
	profile.movement = (movement === null) ? "-" : movement.textContent;
	const weaponSkill = characteristics.querySelector(":scope > characteristic[name=\"WS\"]").firstChild;
	profile.weaponSkill = (weaponSkill === null) ? "-" : weaponSkill.textContent;
	const ballisticSkill = characteristics.querySelector(":scope > characteristic[name=\"BS\"]").firstChild;
	profile.ballisticSkill = (ballisticSkill === null) ? "-" : ballisticSkill.textContent;
	const strength = characteristics.querySelector(":scope > characteristic[name=\"S\"]").firstChild;
	profile.strength = (strength === null) ? "-" : strength.textContent;
	const toughness = characteristics.querySelector(":scope > characteristic[name=\"T\"]").firstChild;
	profile.toughness = (toughness === null) ? "-" : toughness.textContent;
	const wounds = characteristics.querySelector(":scope > characteristic[name=\"W\"]").firstChild;
	profile.wounds = (wounds === null) ? "-" : wounds.textContent;
	const initiative = characteristics.querySelector(":scope > characteristic[name=\"I\"]").firstChild;
	profile.initiative = (initiative === null) ? "-" : initiative.textContent;
	const attacks = characteristics.querySelector(":scope > characteristic[name=\"A\"]").firstChild;
	profile.attacks = (attacks === null) ? "-" : attacks.textContent;
	const leadership = characteristics.querySelector(":scope > characteristic[name=\"LD\"]").firstChild;
	profile.leadership = (leadership === null) ? "-" : leadership.textContent;
	const troopType = characteristics.querySelector(":scope > characteristic[name=\"Type\"]").firstChild;
	profile.troopType = (troopType === null) ? "-" : troopType.textContent;

	return profile;
}

function parseSpell(spellRoot) {
	const characteristics = spellRoot.querySelector(":scope > characteristics");

	const selectionRoot = spellRoot.parentElement.parentElement;

	let spell = {};
	spell.lore = selectionRoot.parentElement.parentElement.getAttribute("name");
	spell.name = selectionRoot.getAttribute("name");
	const level = characteristics.querySelector(":scope > characteristic[name=\"Spell Level\"]");
	spell.level = (level === null) ? "-" : level.textContent;
	const type = characteristics.querySelector(":scope > characteristic[name=\"Type\"]");
	spell.type = (type === null) ? "-" : type.textContent;
	const castingValue = characteristics.querySelector(":scope > characteristic[name=\"Casting Value\"]");
	spell.castingValue = (castingValue === null) ? "-" : castingValue.textContent;
	const range = characteristics.querySelector(":scope > characteristic[name=\"Range\"]");
	spell.range = (range === null) ? "-" : range.textContent;
	const details = characteristics.querySelector(":scope > characteristic[name=\"Details\"]");
	spell.details = (details === null) ? "-" : details.textContent;

	return spell;
}

function parseUpgrades(unitRoot) {

	let upgrades = [];

	const upgradeRoots = unitRoot.querySelectorAll(":scope > selections > selection");
	upgradeRoots.forEach(upgradeRoot => {
		if (upgradeShouldBeIgnored(upgradeRoot)) {
			return;
		}

		let upgradeType = "upgrade";
		if (upgradeRoot.querySelector(":scope > profiles > profile[typeName=\"Model\"]")) {
			upgradeType = "nestedUnit";
		}

		let upgrade = {
			type: upgradeType,
			name: upgradeRoot.getAttribute("name"),
			count: upgradeRoot.getAttribute("number"),
			cost: upgradeRoot.querySelector(":scope > costs > cost[name=\"pts\"]").getAttribute("value"),
			rules: parseRules(upgradeRoot),
			upgrades: parseUpgrades(upgradeRoot)
		};

		upgrades.push(upgrade);
	});

	return upgrades;
}

function flattenRulesAndSelections(unit) {
	let rules = {};
	let selections = {};
	let nestedUnits = [];

	Object.keys(unit.rules).forEach(ruleName => {
		rules[ruleName] = unit.rules[ruleName];
	});

	unit.upgrades.forEach(upgrade => {
		if (selections[upgrade.name] === undefined) {
			selections[upgrade.name] = upgrade.count;
		} else {
			selections[upgrade.name] = Math.max(selections[upgrade.name], upgrade.count);
		}

		if (upgrade.type === "nestedUnit") {
			nestedUnits.push(upgrade);
			return;
		}

		Object.keys(upgrade.rules).forEach(ruleName => {
			rules[ruleName] = upgrade.rules[ruleName];
		});
	});

	nestedUnits.forEach(nestedUnit => {
		flattenRulesAndSelections(nestedUnit);
	});

	unit.rules = rules;
	unit.upgrades = selections;
	unit.nestedUnits = nestedUnits;
}

function parseWeaponProfile(profileRoot) {
	const characteristics = profileRoot.querySelector(":scope > characteristics");

	const range = characteristics.querySelector(":scope > characteristic[name=\"Range\"]").firstChild
	const strength = characteristics.querySelector(":scope > characteristic[name=\"Strength\"]").firstChild
	const specialRules = characteristics.querySelector(":scope > characteristic[name=\"Special Rules\"]").firstChild

	return {
		name: profileRoot.getAttribute("name"),
		range: (range !== null) ? range.textContent : "-",
		strength: (strength !== null) ? strength.textContent : "-",
		specialRules: (specialRules !== null) ? specialRules.textContent : "-"
	};
}

function parseArmourProfile(profileRoot) {
	const characteristics = profileRoot.querySelector(":scope > characteristics");

	const combat = characteristics.querySelector(":scope > characteristic[name=\"Combat\"]").firstChild
	const missile = characteristics.querySelector(":scope > characteristic[name=\"Missile\"]").firstChild
	const specialRules = characteristics.querySelector(":scope > characteristic[name=\"Special Rules\"]").firstChild

	return {
		name: profileRoot.getAttribute("name"),
		combat: (combat !== null) ? combat.textContent : "-",
		missile: (missile !== null) ? missile.textContent : "-",
		specialRules: (specialRules !== null) ? specialRules.textContent : "-"
	};
}

function parseGenericProfile(profileRoot) {
	let profile = {};
	profile.typeName = profileRoot.getAttribute("typeName");
	profile.name = profileRoot.getAttribute("name");

	const characteristicRoots = profileRoot.querySelectorAll(":scope > characteristics > characteristic");
	characteristicRoots.forEach(characteristicRoot => {
		const key = characteristicRoot.getAttribute("name");
		const value = (characteristicRoot.firstChild !== null) ?
			characteristicRoot.firstChild.textContent :
			"-"
		profile[key] = value;
	})

	return profile;
}

function parseRules(root) {
	let rules = {};
	const ruleRoots = root.querySelectorAll(":scope > rules > rule")
	ruleRoots.forEach(ruleRoot => {
		const description = ruleRoot.querySelector(":scope > description");
		rules[ruleRoot.getAttribute("name")] = (description != null) ? description.textContent : "";
	});

	return rules;
}

// Ignore specific upgrades that have been al ready processed, like spells
function upgradeShouldBeIgnored(upgradeRoot) {
	const spellProfile =
		upgradeRoot.querySelector(":scope > selections > selection > profiles > profile[typeName=\"Spell\"]");
	if (spellProfile !== null) {
		return true;
	}

	return false;
}

function createRosterView(roster) {
	console.log(roster);

	let root = createDiv();
	root.id = "roster";

	titleText = "[" + roster.armyName + "] " +
		roster.name +
		" (" + roster.points + "/" + roster.maxPoints + " pts)";
	let titleNode = createElementWithText("h2", titleText);
	root.appendChild(titleNode);

	let categoriesPtsNode = createCategoriesPts(roster);
	root.appendChild(categoriesPtsNode);

	roster.units.forEach(unit => {
		root.appendChild(createUnitView(unit));
	});

	let ruleDescriptionsNode = createRuleDescriptionsView(roster.ruleDescriptions);
	root.appendChild(ruleDescriptionsNode);

	applyColors(root);

	return root;
}

function createCategoriesPts(roster) {
	let root = createDiv("categories-pts");

	let title = createSectionHeader("Points per category:")
	title.removeChild(title.firstChild); // Remove draggable
	root.appendChild(title);

	let pts = {
		lords: 0,
		heroes: 0,
		core: 0,
		special: 0,
		rare: 0
	};

	roster.units.forEach(unit => {
		if (unit.category === "Lords") {
			pts.lords += unit.cost;
			pts.heroes += unit.cost;
		} else if (unit.category === "Heroes") {
			pts.heroes += unit.cost;
		} else if (unit.category === "Core") {
			pts.core += unit.cost;
		} else if (unit.category === "Special") {
			pts.special += unit.cost;
		} else if (unit.category === "Rare") {
			pts.rare += unit.cost;
		}
	});

	let ulNode = document.createElement("ul");
	ulNode.className = "section-content";
	root.appendChild(ulNode);

	let lordsPercentage = ((roster.maxPoints > 0) ? (pts.lords / roster.maxPoints) : 0) * 100;
	let lordsText = "Lords: " + pts.lords.toFixed(1) + " pts [" + lordsPercentage.toFixed(2) + "%]";
	let lordsNode = createElementWithText("li", lordsText);
	ulNode.appendChild(lordsNode);
	if (lordsPercentage > 25) {
		lordsNode.className = "wrong";
	}

	let heroesPercentage = ((roster.maxPoints > 0) ? (pts.heroes / roster.maxPoints) : 0) * 100;
	let heroesText = "Heroes: " + pts.heroes.toFixed(1) + " pts [" + heroesPercentage.toFixed(2) + "%]";
	let heroesNode = createElementWithText("li", heroesText);
	ulNode.appendChild(heroesNode);
	if (heroesPercentage > 35) {
		heroesNode.className = "wrong";
	}

	let corePercentage = ((roster.maxPoints > 0) ? (pts.core / roster.maxPoints) : 0) * 100;
	let coreText = "Core: " + pts.core.toFixed(1) + " pts [" + corePercentage.toFixed(2) + "%]";
	let coreNode = createElementWithText("li", coreText);
	ulNode.appendChild(coreNode);
	if (roster.maxPoints > 0 && corePercentage < 25) {
		coreNode.className = "wrong";
	}

	let specialPercentage = ((roster.maxPoints > 0) ? (pts.special / roster.maxPoints) : 0) * 100;
	let specialText = "Special: " + pts.special.toFixed(1) + " pts [" + specialPercentage.toFixed(2) + "%]";
	let specialNode = createElementWithText("li", specialText);
	ulNode.appendChild(specialNode);
	if (specialPercentage > 50) {
		specialNode.className = "wrong";
	}

	let rarePercentage = ((roster.maxPoints > 0) ? (pts.rare / roster.maxPoints) : 0) * 100;
	let rareText = "Rare: " + pts.rare.toFixed(1) + " pts [" + rarePercentage.toFixed(2) + "%]";
	let rareNode = createElementWithText("li", rareText);
	ulNode.appendChild(rareNode);
	if (rarePercentage > 25) {
		rareNode.className = "wrong";
	}

	return root;
}

function createUnitView(unit) {
	let unitRoot = createDiv("unit");

	// name, category, cost
	let headerNode = createSectionHeader(unit.name + " [" + unit.category + "]");
	headerNode.classList.add("unit-name");
	unitRoot.appendChild(headerNode);

	let rightAlignedNode = createElementWithText("span", unit.cost + " pts");
	headerNode.appendChild(rightAlignedNode);

	let unitContent = createDiv();
	unitRoot.appendChild(unitContent);

	// profiles
	const profilesNode = createProfilesView(unit.profiles);
	unitContent.appendChild(profilesNode);

	// selections
	const selectionsNode = createSelectionsView(unit);
	unitContent.appendChild(selectionsNode)

	// rules
	const rulesNode = createRulesView(unit);
	unitContent.appendChild(rulesNode);

	// equipment
	if (unit.weapons.length > 0 || unit.armours.length > 0) {
		const equipmentNode = createEquipmentView(unit);
		unitContent.appendChild(equipmentNode);
	}

	// spells
	if (Object.keys(unit.spells).length > 0) {
		const spellsNode = createSpellsView(unit.spells);
		unitContent.appendChild(spellsNode)
	}

	// other stats
	if (Object.keys(unit.extraProfiles).length > 0) {
		const otherStatsNode = createOtherStatsView(unit.extraProfiles);
		unitContent.appendChild(otherStatsNode);
	}

	// comments
	const commentsNode = createCommentsView();
	unitContent.appendChild(commentsNode);

	return unitRoot;
}

function createProfilesView(profiles) {
	let root = createDiv("profile section");

	if (!profiles) {
		return root;
	}

	let table = document.createElement("table");
	table.className = "section-content";
	root.appendChild(table);

	profiles.forEach(profile => {
		// Top
		let topRow = createRow();
		table.appendChild(topRow);

		let name = createCell();
		name.setAttribute("rowspan", 2);
		topRow.appendChild(name);
		let profileToggle = createCheckbox();
		name.appendChild(profileToggle);
		let nameText = createElementWithText("span", profile.name);
		name.appendChild(nameText);

		let movement = createCell();
		movement.textContent = "M";
		topRow.appendChild(movement);

		let weaponSkill = createCell();
		weaponSkill.textContent = "WeS";
		weaponSkill.className = "to-hit";
		topRow.appendChild(weaponSkill);

		let ballisticSkill = createCell();
		ballisticSkill.textContent = "BS";
		ballisticSkill.className = "to-hit";
		topRow.appendChild(ballisticSkill);

		let strength = createCell();
		strength.textContent = "S";
		strength.className = "to-wound";
		topRow.appendChild(strength)

		let toughness = createCell();
		toughness.textContent = "T";
		toughness.className = "to-wound";
		topRow.appendChild(toughness)

		let wounds = createCell();
		wounds.textContent = "W";
		wounds.className = "wounds";
		topRow.appendChild(wounds)

		let initiative = createCell();
		initiative.textContent = "I";
		topRow.appendChild(initiative)

		let attacks = createCell();
		attacks.textContent = "A";
		topRow.appendChild(attacks)

		let leadership = createCell();
		leadership.textContent = "LD";
		topRow.appendChild(leadership)

		let armourSave = createCell();
		armourSave.textContent = "AS";
		armourSave.className = "saves";
		topRow.appendChild(armourSave)

		let wardSave = createCell();
		wardSave.textContent = "WaS";
		wardSave.className = "saves";
		topRow.appendChild(wardSave)

		let type = createCell();
		type.textContent = "Type";
		type.className = "troop-type";
		topRow.appendChild(type)

		// Bottom
		let bottomRow = createRow();
		table.appendChild(bottomRow);

		let movementValue = createCell();
		movementValue.textContent = profile.movement;
		bottomRow.appendChild(movementValue);

		let weaponSkillValue = createCell();
		weaponSkillValue.textContent = profile.weaponSkill;
		weaponSkillValue.className = "to-hit";
		bottomRow.appendChild(weaponSkillValue);

		let ballisticSkillValue = createCell();
		ballisticSkillValue.textContent = profile.ballisticSkill;
		ballisticSkillValue.className = "to-hit";
		bottomRow.appendChild(ballisticSkillValue);

		let strengthValue = createCell();
		strengthValue.textContent = profile.strength;
		strengthValue.className = "to-wound";
		bottomRow.appendChild(strengthValue)

		let toughnessValue = createCell();
		toughnessValue.textContent = profile.toughness;
		toughnessValue.className = "to-wound";
		bottomRow.appendChild(toughnessValue)

		let woundsValue = createCell();
		woundsValue.textContent = profile.wounds;
		woundsValue.className = "wounds";
		bottomRow.appendChild(woundsValue)

		let initiativeValue = createCell();
		initiativeValue.textContent = profile.initiative;
		bottomRow.appendChild(initiativeValue)

		let attacksValue = createCell();
		attacksValue.textContent = profile.attacks;
		bottomRow.appendChild(attacksValue)

		let leadershipValue = createCell();
		leadershipValue.textContent = profile.leadership;
		bottomRow.appendChild(leadershipValue)

		let armourSaveValue = createCell();
		armourSaveValue.textContent = "";
		armourSaveValue.className = "saves";
		bottomRow.appendChild(armourSaveValue)

		let wardSaveValue = createCell();
		wardSaveValue.textContent = "";
		wardSaveValue.className = "saves";
		bottomRow.appendChild(wardSaveValue)

		let typeValue = createCell();
		typeValue.textContent = profile.troopType;
		typeValue.className = "troop-type";
		bottomRow.appendChild(typeValue)
	});

	return root;
}

function createEquipmentView(unit) {
	let root = createDiv("equipment section");

	if (!unit) {
		return root;
	}

	let headerNode = createSectionHeader("Equipment:");
	root.appendChild(headerNode);

	let contentNode = createDiv("section-content")

	let equipment = {};
	unit.weapons.forEach(weapon => {
		const key = weapon.name + " ["
			+ weapon.range
			+ ", S: " + ((weapon.strength !== "") ? weapon.strength : "-")
			+ "]";
		equipment[key] = weapon.specialRules;
	});
	unit.armours.forEach(armour => {
		const key = armour.name + " [" + armour.combat + "/" + armour.missile + "]";
		equipment[key] = armour.specialRules;
	});


	const sortedKeys = Object.keys(equipment).sort((lhs, rhs) => {
		return (lhs + equipment[lhs]).length < (rhs + equipment[rhs]).length;
	});
	for (let i = 0; i < sortedKeys.length; i++) {
		let itemNode = createDiv();
		itemNode.style = "order: " + i;

		let toggle = createCheckbox();
		itemNode.appendChild(toggle);

		let spanNode = createElementWithText("span", sortedKeys[i]);
		itemNode.appendChild(spanNode);

		const description = equipment[sortedKeys[i]].trim();
		if (description !== "" && description !== "-") {
			let descriptionText = document.createTextNode(" " + description);
			itemNode.append(descriptionText);
		}
		contentNode.appendChild(itemNode);
	}

	root.appendChild(contentNode);


	return root;
}

function createSpellsView(spells) {
	let root = createDiv("spells section");

	if (!spells) {
		return root;
	}

	let headerNode = createSectionHeader("Spells:");
	root.appendChild(headerNode);

	let contentNode = createDiv("section-content");
	const keys = Object.keys(spells);
	keys.forEach(lore => {
		let loreNode = createDiv();
		loreNode.appendChild(createElementWithText("span", lore + ":"))

		let ulNode = document.createElement("ul");
		spells[lore].forEach(spell => {
			let liNode = document.createElement("li");
			ulNode.appendChild(liNode);

			let wrapperNode = createDiv();
			liNode.appendChild(wrapperNode);

			let toggle = createCheckbox();
			wrapperNode.appendChild(toggle);

			let nameText = spell.name + " ["
				+ spell.level
				+ ((spell.type !== "") ? (", " + spell.type) : "")
				+ ((spell.castingValue !== "") ? (", " + spell.castingValue) : "")
				+ ((spell.range !== "") ? (", " + spell.range) : "")
				+ "]: ";
			wrapperNode.appendChild(createElementWithText("span", nameText));

			let descriptionText = document.createTextNode(spell.description);
			wrapperNode.appendChild(descriptionText);
		});

		loreNode.appendChild(ulNode);
		contentNode.appendChild(loreNode);
	});

	root.appendChild(contentNode);

	return root;
}

function createOtherStatsView(extraProfiles) {
	let root = createDiv("other-stats section");

	if (!extraProfiles) {
		return root;
	}

	let headerNode = createSectionHeader("Other stats:");
	root.appendChild(headerNode);

	let content = createDiv("section-content");

	Object.keys(extraProfiles).forEach(key => {
		let table = document.createElement("table");
		let headerRow = createRow();
		table.appendChild(headerRow);

		const items = extraProfiles[key];
		let propertyNames = Object.keys(items[0]);
		propertyNames.splice(propertyNames.indexOf("typeName"), 1);


		let headerCell = createElementWithText("th", key);
		headerCell.setAttribute("colspan", propertyNames.length)
		headerRow.appendChild(headerCell);
		let headerToggle = createCheckbox();
		headerCell.insertBefore(headerToggle, headerCell.firstChild);

		// property names row
		let propertyNamesRow = createRow();
		propertyNames.forEach(property => {
			// special handling because "name" is an internal property name and is not
			// capitalized by default
			const propertyText = property.charAt(0).toUpperCase() + property.slice(1);

			propertyNamesRow.appendChild(createHeaderCell(propertyText));
		});
		table.append(propertyNamesRow);

		// items rows
		items.forEach(item => {
			let row = createRow();

			propertyNames.forEach(propertyName => {
				let cell = createCell(item[propertyName]);
				row.appendChild(cell);
			});

			let toggle = createCheckbox();
			row.firstChild.insertBefore(toggle, row.firstChild.firstChild);

			table.appendChild(row);
		});

		content.appendChild(table);
	});

	root.append(content);

	return root;
}

function createSelectionsView(unit) {
	let root = createDiv("selections section");

	if (!unit) {
		return root;
	}

	let headerNode = createSectionHeader("Selections:");
	root.appendChild(headerNode);

	let contentNode = createDiv("section-content");
	root.appendChild(contentNode);

	function createViewForUnit(unit, parentNode) {
		let unitWrapperNode = createDiv();
		let unitNameNode = createElementWithText("span", unit.name, "bold");
		unitWrapperNode.appendChild(unitNameNode);
		parentNode.appendChild(unitWrapperNode);

		function createUpgradesView(upgrades) {
			let wrapper = document.createElement("span");

			let names = Object.keys(upgrades);

			let i = 0;
			for (; i < names.length - 1; i++) {
				let span = document.createElement("span");
				span.className = "selection";
				wrapper.appendChild(span);
				let toggle = createCheckbox();
				span.appendChild(toggle);

				let upgradeName = names[i];
				if (upgrades[names[i]] > 1) {
					upgradeName += " [" + (upgrades[names[i]]) + "]";
				}
				upgradeName += ", ";

				let text = document.createTextNode(upgradeName);
				span.appendChild(text);
			}

			let span = document.createElement("span");
			span.className = "selection";
			wrapper.appendChild(span);
			let toggle = createCheckbox();
			span.appendChild(toggle);

			let upgradeName = names[i];
			if (upgrades[names[i]] > 1) {
				upgradeName += " [" + (upgrades[names[i]]) + "]";
			}

			let text = document.createTextNode(upgradeName);
			span.appendChild(text);

			return wrapper;
		};

		if (Object.keys(unit.upgrades).length > 0) {
			unitNameNode.textContent = unitWrapperNode.textContent + ": ";
			unitWrapperNode.appendChild(createUpgradesView(unit.upgrades));
		}


		if (unit.nestedUnits.length > 0) {
			let listNode = document.createElement("ul");
			parentNode.appendChild(listNode);

			unit.nestedUnits.forEach(nestedUnit => {
				if (Object.keys(nestedUnit.upgrades).length === 0) {
					return;
				}

				let itemNode = document.createElement("li");
				createViewForUnit(nestedUnit, itemNode);
				listNode.appendChild(itemNode);
			});
		}
	}

	createViewForUnit(unit, contentNode);

	return root;
}

function createRulesView(unit) {
	let root = createDiv("rules section");

	if (!unit) {
		return root;
	}

	let headerNode = createSectionHeader("Rules:");
	root.appendChild(headerNode);

	let contentNode = createDiv("section-content");
	root.appendChild(contentNode);

	function createViewForUnit(unit, parentNode) {
		let unitWrapperNode = createDiv();
		let unitNameNode = createElementWithText("span", unit.name, "bold");
		unitWrapperNode.appendChild(unitNameNode);
		parentNode.appendChild(unitWrapperNode);

		function createRulesView(rules) {

			let wrapper = document.createElement("span");

			let names = Object.keys(rules);

			let i = 0;
			for (; i < names.length - 1; i++) {
				let span = document.createElement("span");
				span.className = "rule";
				wrapper.appendChild(span);
				let toggle = createCheckbox();
				span.appendChild(toggle);

				let ruleName = names[i];
				if (rules[names[i]] > 1) {
					ruleName += " [" + (rules[names[i]]) + "]";
				}
				ruleName += ", ";

				let text = document.createTextNode("\u00A0" + ruleName);
				span.appendChild(text);
			}

			let span = document.createElement("span");
			span.className = "rule";
			wrapper.appendChild(span);
			let toggle = createCheckbox();
			span.appendChild(toggle);

			let ruleName = names[i];
			if (rules[names[i]] > 1) {
				ruleName += " [" + (rules[names[i]]) + "]";
			}

			let text = document.createTextNode("\u00A0" + ruleName);
			span.appendChild(text);

			return wrapper;
		};

		if (Object.keys(unit.rules).length > 0) {
			unitNameNode.textContent = unitWrapperNode.textContent + ": ";
			unitWrapperNode.appendChild(createRulesView(unit.rules));
		}


		if (unit.nestedUnits.length > 0) {
			let listNode = document.createElement("ul");
			parentNode.appendChild(listNode);

			unit.nestedUnits.forEach(nestedUnit => {
				if (Object.keys(nestedUnit.rules).length === 0) {
					return;
				}

				let itemNode = document.createElement("li");
				createViewForUnit(nestedUnit, itemNode);
				listNode.appendChild(itemNode);
			});
		}
	}

	createViewForUnit(unit, contentNode);

	return root;
}

function createCommentsView() {
	root = createDiv("comments section");

	let headerNode = createSectionHeader("Comments:", true);
	root.appendChild(headerNode);

	let contentNode = createDiv("section-content collapsed");
	root.appendChild(contentNode);

	let textArea = document.createElement("textarea");
	contentNode.appendChild(textArea);

	return root;
}

function createRuleDescriptionsView(ruleDescriptions) {
	let root = createDiv("rule-descriptions");

	let header = createSectionHeader("Rule descriptions:");
	header.removeChild(header.firstChild);
	root.appendChild(header);

	let ulNode = document.createElement("ul");
	ulNode.className = "section-content";
	root.appendChild(ulNode);
	Object.keys(ruleDescriptions).forEach(ruleName => {
		let liNode = document.createElement("li");
		ulNode.appendChild(liNode);

		let toggle = createCheckbox();
		liNode.appendChild(toggle);

		let nameNode = createElementWithText("span", ruleName + ": ");
		liNode.appendChild(nameNode);

		let descriptionNode = document.createTextNode(ruleDescriptions[ruleName]);
		liNode.appendChild(descriptionNode);
	});

	return root;
}

function addInputCallbacks(root) {
	addHeaderToggles(root);

	let draggables = root.querySelectorAll(":scope .draggable");
	draggables.forEach(addDraggableToElement);

	addCheckboxCallbacks(root);
	addTogglePrivateCallback(root);
	addColorPickerCallbacks();
}

function addHeaderToggles(root) {
	let headers = root.querySelectorAll(":scope .section-header")
	headers.forEach(header => {
		header.onclick = () => {
			let content = header.nextSibling;
			toggleClass(content, "collapsed");
			let arrowNode = header.querySelector(":scope .arrow");
			if (content.classList.contains("collapsed")) {
				arrowNode.textContent = "▷";
			} else {
				arrowNode.textContent = "▽";
			}
		};
	});
}

function addDraggableToElement(draggable) {
	draggable.setAttribute("draggable", true);

	function findRootAndDragType(element) {
		let root = draggable;
		let dragType = UNIT;
		let found = false;
		while (root && !found) {
			root = root.parentElement;
			if (root.classList.contains("unit")) {
				dragType = UNIT;
				found = true;
			} else if (root.classList.contains("section")) {
				dragType = SECTION;
				found = true;
			}
		}

		return [root, dragType]
	}

	let [root, _] = findRootAndDragType(draggable);

	root.ondragstart = event => {
		let [element, dragType] = findRootAndDragType(event.target);
		globals.draggedElement = element;
		globals.dragType = dragType;

		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", null);
		event.dataTransfer.setDragImage(element, 25, 25);

		event.stopPropagation();
	};


	root.ondragover = event => {
		function findRoot(element, dragType) {
			let root = element.parentElement;

			let desiredClass = (dragType === UNIT) ? "unit" : "section";
			while (root && !root.classList.contains(desiredClass)) {
				root = root.parentElement;
			}

			return root;
		}

		function isBefore(lhs, rhs) {
			if (rhs.parentNode === lhs.parentNode) {
				for (let current = lhs.previousSibling;
					current;
					current = current.previousSibling) {
					if (current === rhs) {
						return true
					}
				}
			}

			return false;
		}

		event.dataTransfer.dropEffect = "move";

		let dragRoot = findRoot(event.target, globals.dragType);
		let draggedElement = globals.draggedElement;

		// Prevent dragging sections across units
		let dragAllowed = dragRoot && dragRoot !== draggedElement;
		if (dragAllowed && globals.dragType == SECTION) {
			dragAllowed = findRoot(dragRoot, UNIT) === findRoot(draggedElement, UNIT);
		}

		if (dragAllowed) {
			let position = (isBefore(draggedElement, dragRoot)) ? "beforebegin" : "afterend";
			draggedElement.parentElement.removeChild(draggedElement);
			dragRoot.insertAdjacentElement(position, draggedElement);
		}

		event.preventDefault();
	};

	root.ondragend = event => {
		globals.draggedElement = null;

		event.stopPropagation();
	}
}

function addCheckboxCallbacks(root) {
	let toggles = root.querySelectorAll(":scope input[type='checkbox']");
	toggles.forEach(toggle => {
		toggle.onclick = event => {
			updateHiddenElements(root);
			event.stopPropagation();
		};
	});
}

function addTogglePrivateCallback(root) {
	let button = document.getElementById("togglePrivateCheckbox");

	button.onclick = event => {
		updateHiddenElements(root);
	};
}

function updateHiddenElements(root) {
	function updateHidden(element) {
		let button = document.getElementById("togglePrivateCheckbox");
		if (button.checked) {
			element.classList.add("hidden");
		} else {
			element.classList.remove("hidden");
		}
	}

	// headers (including units)
	let headersToggles = root.querySelectorAll(":scope .section-header > input:checked");
	headersToggles.forEach(toggle => {
		updateHidden(toggle.parentElement.parentElement);
	});

	// profiles
	let profilesToggles = root.querySelectorAll(":scope .profile input:checked");
	profilesToggles.forEach(toggle => {
		updateHidden(toggle.parentElement.parentElement);
		updateHidden(toggle.parentElement.parentElement.nextSibling);
	})

	// selections & rules
	let selectionsToggles = root.querySelectorAll(":scope .selections > .section-content input:checked")
	selectionsToggles.forEach(toggle => {
		updateHidden(toggle.parentElement);
	});
	let rulestoggles = root.querySelectorAll(":scope .rules > .section-content input:checked")
	rulestoggles.forEach(toggle => {
		updateHidden(toggle.parentElement);
	});

	// equipment
	let equipmentToggles = root.querySelectorAll(":scope .equipment input:checked");
	equipmentToggles.forEach(toggle => {
		updateHidden(toggle.parentElement);
	});

	// spells
	let spellsToggles = root.querySelectorAll(":scope .spells input:checked");
	spellsToggles.forEach(toggle => {
		updateHidden(toggle.parentElement.parentElement);
	});

	// other stats
	let otherStatsTableToggles = root.querySelectorAll(":scope .other-stats th > input:checked");
	otherStatsTableToggles.forEach(toggle => {
		updateHidden(toggle.parentElement.parentElement.parentElement);
	});
	let otherStatsRowToggles = root.querySelectorAll(":scope .other-stats tr input:checked");
	otherStatsRowToggles.forEach(toggle => {
		updateHidden(toggle.parentElement.parentElement);
	});

	// rule descriptions
	let rulesDescriptionsToggles = root.querySelectorAll(":scope .rule-descriptions input:checked");
	rulesDescriptionsToggles.forEach(toggle => {
		updateHidden(toggle.parentElement);
	});
}

function addColorPickerCallbacks() {
	let colorPickers = document.querySelectorAll(":scope .color-picker");
	colorPickers.forEach(picker => {
		picker.addEventListener("input", event => {
			applyColors(document.getElementById("roster"));
		});
	});
}

function applyColors(root) {
	// seaders
	const headerColor = document.querySelector("#headersColor");
	let headers = root.querySelectorAll(":scope .section-header.unit-name");
	headers.forEach(header => {
		header.style.background = headerColor.value;
	});

	let categoriesHeader = root.querySelector(":scope .categories-pts .section-header");
	categoriesHeader.style.background = headerColor.value;

	let ruleDescriptionsHeader = root.querySelector(":scope .rule-descriptions .section-header")
	ruleDescriptionsHeader.style.background = headerColor.value;

	// sections
	const sectionsColor = document.querySelector("#sectionsColor");
	let sections = root.querySelectorAll(":scope .section > .section-header");
	sections.forEach(section => {
		section.style.background = sectionsColor.value;
	});

	// to hit
	const toHitColor = document.querySelector("#toHitColor");
	let toHitElements = root.querySelectorAll(":scope .to-hit");
	toHitElements.forEach(toHitElement => {
		toHitElement.style.background = toHitColor.value;
	});

	// to wound
	const toWoundColor = document.querySelector("#toWoundColor");
	let toWoundElements = root.querySelectorAll(":scope .to-wound");
	toWoundElements.forEach(element => {
		element.style.background = toWoundColor.value;
	});

	// wounds
	const woundsColor = document.querySelector("#woundsColor");
	let woundsElements = root.querySelectorAll(":scope .wounds");
	woundsElements.forEach(woundsElement => {
		woundsElement.style.background = woundsColor.value;
	});

	// saves
	const savesColor = document.querySelector("#savesColor");
	let savesElements = root.querySelectorAll(":scope .saves");
	savesElements.forEach(savesElement => {
		savesElement.style.background = savesColor.value;
	});

	// other stats
	const otherStatsColor = document.querySelector("#otherStatsColor");
	let otherStatsHeaders = root.querySelectorAll(":scope .other-stats tr:first-child > th");
	otherStatsHeaders.forEach(otherStatsHeader => {
		otherStatsHeader.style.background = otherStatsColor.value;
	});
}

window.onload = event => {
	// setup reset color buttons

	let headerColorReset = document.getElementById("headersColorReset");
	headerColorReset.onclick = event => {
		document.getElementById("headersColor").value = "#add8e6";
		applyColors(document.getElementById("roster"));
	};

	let sectionsColorReset = document.getElementById("sectionsColorReset");
	sectionsColorReset.onclick = event => {
		document.getElementById("sectionsColor").value = "#e0ffff";
		applyColors(document.getElementById("roster"));
	};

	let tohitColorReset = document.getElementById("toHitColorReset");
	tohitColorReset.onclick = event => {
		document.getElementById("toHitColor").value = "#bbbbff";
		applyColors(document.getElementById("roster"));
	};

	let toWoundColorReset = document.getElementById("toWoundColorReset");
	toWoundColorReset.onclick = event => {
		document.getElementById("toWoundColor").value = "#fff888";
		applyColors(document.getElementById("roster"));
	};

	let woundsColorReset = document.getElementById("woundsColorReset");
	woundsColorReset.onclick = event => {
		document.getElementById("woundsColor").value = "#88dd88";
		applyColors(document.getElementById("roster"));
	};

	let savesColorReset = document.getElementById("savesColorReset");
	savesColorReset.onclick = event => {
		document.getElementById("savesColor").value = "#ff8888";
		applyColors(document.getElementById("roster"));
	};

	let otherStatsColorReset = document.getElementById("otherStatsColorReset");
	otherStatsColorReset.onclick = event => {
		document.getElementById("otherStatsColor").value = "#fffff0";
		applyColors(document.getElementById("roster"));
	};
};