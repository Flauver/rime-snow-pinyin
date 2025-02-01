local snow = require "snow.snow"

local number_to_stroke = {
  ["1"] = "一",
  ["2"] = "丨",
  ["3"] = "丿",
  ["4"] = "丶",
  ["5"] = "乙",
}

---@class AssistEnv: Env
---@field strokes table<string, string>
---@field radicals table<string, string>
---@field radical_sipin table<string, string>
---@field hint string?
---@field strokes_map table<string, string>
---@field reverse_strokes_map table<string, string>

local function table_from_tsv(path)
  ---@type table<string, string>
  local result = {}
  local file = io.open(path, "r")
  if not file then
    return result
  end
  for line in file:lines() do
    ---@type string, string
    local character, content = line:match("([^\t]+)\t([^\t]+)")
    if not content or not character then
      goto continue
    end
    result[character] = content
    ::continue::
  end
  file:close()
  return result
end

local filter = {}

---@param env AssistEnv
function filter.init(env)
  local dir = rime_api.get_user_data_dir() .. "/lua/snow/"
  env.strokes = table_from_tsv(dir .. "strokes.txt")
  env.radicals = table_from_tsv(dir .. "radicals.txt")
  env.radical_sipin = table_from_tsv(dir .. "radical_sipin.txt")
  env.hint = env.engine.schema.config:get_string("speller/hint_shape")
  env.strokes_map = {}
  env.reverse_strokes_map = {}
  local raw = env.engine.schema.config:get_map("speller/strokes")
  if not raw then return end
  for _, key in ipairs(raw:keys()) do
    local value = raw:get_value(key)
    if value then
      env.strokes_map[value:get_string()] = key
      env.reverse_strokes_map[key] = value:get_string()
    end
  end
end

---@param translation Translation
---@param env AssistEnv
function filter.func(translation, env)
  local context = env.engine.context
  local shape_input = context:get_property("shape_input")
  for candidate in translation:iter() do
    local code = ""
    local prompt = ""
    local partial_code = ""
    if shape_input:len() > 0 and shape_input:sub(1, 1) == "1" then
      partial_code = shape_input:sub(2)
      code = env.radicals[candidate.text] or ""
      if code:len() > 0 then
        code = env.radical_sipin[code] .. " " .. code
      end
      prompt = " 部首 [" .. partial_code .. "]"
    else
      partial_code = shape_input:gsub(".", env.strokes_map)
      code = env.strokes[candidate.text] or ""
      local maybe_prompt = " 笔画 [" .. partial_code:gsub("%d", number_to_stroke) .. "]"
      prompt = #shape_input > 0 and maybe_prompt or ""
    end
    if not code or code:sub(1, #partial_code) == partial_code then
      candidate.comment = code:gsub(".", env.reverse_strokes_map)
      candidate.preedit = candidate.preedit .. prompt
      yield(candidate)
    end
  end
end

---@param segment Segment
---@param env AssistEnv
function filter.tags_match(segment, env)
  local current = snow.current(env.engine.context)
  if not current then return false end
  if env.hint and rime_api.regex_match(current, env.hint) then return true end
  local shape_input = env.engine.context:get_property("shape_input")
  if shape_input:len() > 0 then return true end
  return false
end

return filter
